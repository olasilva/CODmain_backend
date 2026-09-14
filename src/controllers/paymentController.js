// src/controllers/paymentController.js
const axios = require('axios');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================================
// Helpers
// ============================================================

async function findStudent(userId) {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, user_id, student_id, full_name, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function ensureStudent(userId, fallbackName) {
  let student = await findStudent(userId);
  if (student) return student;

  const { data: userRows } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name')
    .eq('id', userId)
    .limit(1);
  const user = userRows?.[0] || null;

  const { data: created, error } = await supabaseAdmin
    .from('students')
    .insert([{
      user_id: userId,
      student_id: `STU-${Date.now()}`,
      full_name:
        fallbackName ||
        user?.full_name ||
        user?.email?.split('@')[0] ||
        null,
      status: 'active',
      created_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return findStudent(userId);
    throw error;
  }
  return created;
}

// ============================================================
// POST /api/payments/initialize
// ============================================================
async function initializePayment(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { amount, email, course, trackName, plan, studentName } = req.body;

    if (!amount || !email) {
      return res.status(400).json({ error: 'Amount and email are required' });
    }

    const amountInKobo = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountInKobo) || amountInKobo < 100) {
      return res.status(400).json({ error: 'Amount must be at least ₦1' });
    }

    const student = await ensureStudent(userId, studentName);

    const params = {
      email,
      amount: amountInKobo,
      callback_url:
        process.env.PAYSTACK_CALLBACK_URL ||
        `${FRONTEND_URL}/payment/callback`,
      metadata: {
        userId,
        studentDbId: student.id,
        studentCode: student.student_id,
        course: course || null,
        trackName: trackName || null,
        plan: plan || null,
        custom_fields: [
          {
            display_name: 'Programme',
            variable_name: 'programme',
            value: [course, trackName].filter(Boolean).join(' · ') || 'N/A',
          },
          {
            display_name: 'Plan',
            variable_name: 'plan',
            value: plan || 'termly',
          },
        ],
      },
    };

    const response = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      params,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data?.status) {
      return res.status(400).json({
        error: 'Paystack initialization failed',
        details: response.data?.message,
      });
    }

    const { authorization_url, access_code, reference } = response.data.data;

    const paymentId = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { data: payment, error: insertErr } = await supabaseAdmin
      .from('payments')
      .insert([{
        student_id: student.id,
        payment_id: paymentId,
        reference,
        amount: Number(amount),
        currency: 'NGN',
        plan: plan || 'termly',
        payment_type: plan || 'termly',
        description: [course, trackName].filter(Boolean).join(' · ') || null,
        status: 'pending',
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (insertErr) {
      console.error('⚠️ Could not save pending payment:', insertErr.message);
    }

    return res.json({
      success: true,
      authorization_url,
      access_code,
      reference,
      paymentId: payment?.payment_id || paymentId,
      amount: Number(amount),
    });
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    console.error('❌ initializePayment error:', detail);
    return res.status(500).json({
      error: 'Failed to initialize payment',
      details: detail,
    });
  }
}

// ============================================================
// GET /api/payments/verify?reference=xxx
// ============================================================
async function verifyPayment(req, res) {
  try {
    const { reference } = req.query;
    if (!reference) {
      return res.status(400).json({ error: 'Reference is required' });
    }

    const response = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      }
    );

    const payload = response.data;
    if (!payload?.status || !payload?.data) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const data = payload.data;
    const isSuccessful = data.status === 'success';

    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabaseAdmin
        .from('payments')
        .update({
          status: isSuccessful ? 'completed' : 'failed',
          transaction_id: data.id?.toString() || null,
          payment_date: isSuccessful ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id);

      if (isSuccessful) {
        await createInvoice(existing[0].student_id, existing[0]);
      }
    }

    const redirectPath = isSuccessful
      ? `/admission/submitted?reference=${reference}`
      : `/payment/failed?reference=${reference}`;

    return res.redirect(`${FRONTEND_URL}${redirectPath}`);
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    console.error('❌ verifyPayment error:', detail);
    return res.redirect(`${FRONTEND_URL}/payment/failed`);
  }
}

// ============================================================
// POST /api/payments/webhook
// ============================================================
async function paystackWebhook(req, res) {
  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('⚠️ Webhook: invalid signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const { reference } = event.data;

      const { data: existing } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('reference', reference)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabaseAdmin
          .from('payments')
          .update({
            status: 'completed',
            transaction_id: event.data.id?.toString() || null,
            payment_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing[0].id);

        await createInvoice(existing[0].student_id, existing[0]);
      }
    } else if (event.event === 'charge.failed') {
      const { reference } = event.data;
      await supabaseAdmin
        .from('payments')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('reference', reference);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ paystackWebhook error:', error.message);
    return res.sendStatus(200);
  }
}

// ============================================================
// createInvoice
// ============================================================
async function createInvoice(studentId, paymentRow) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('invoices')
      .select('id')
      .eq('payment_id', paymentRow.payment_id)
      .limit(1);

    if (existing && existing.length > 0) return;

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await supabaseAdmin.from('invoices').insert([{
      student_id: studentId,
      payment_id: paymentRow.payment_id,
      invoice_number: invoiceNumber,
      amount: paymentRow.amount,
      status: 'paid',
      items: [{
        description: paymentRow.description || 'Programme fee',
        amount: paymentRow.amount,
      }],
      created_at: new Date().toISOString(),
    }]);
  } catch (err) {
    console.error('⚠️ createInvoice failed:', err.message);
  }
}

// ============================================================
// GET /api/payments/history
// ============================================================
async function getPaymentHistory(req, res) {
  try {
    const userId = req.user?.id;
    const student = await findStudent(userId);

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(payments || []);
  } catch (error) {
    console.error('❌ getPaymentHistory error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
}

// ============================================================
// GET /api/payments/invoices
// ============================================================
async function getInvoices(req, res) {
  try {
    const userId = req.user?.id;
    const student = await findStudent(userId);

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: invoices, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(invoices || []);
  } catch (error) {
    console.error('❌ getInvoices error:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
}

module.exports = {
  initializePayment,
  verifyPayment,
  paystackWebhook,
  getPaymentHistory,
  getInvoices,
};