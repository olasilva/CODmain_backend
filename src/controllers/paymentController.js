// src/controllers/paymentController.js
const axios = require('axios');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

// ─── School bank account (from .env, with sensible fallbacks) ───
const SCHOOL_BANK = {
  bank_name: process.env.SCHOOL_BANK_NAME || 'Bank Name',
  account_name: process.env.SCHOOL_ACCOUNT_NAME || 'Clan of David Art & Music Academy',
  account_number: process.env.SCHOOL_ACCOUNT_NUMBER || '0000000000',
};

// Handles "url1,url2" in FRONTEND_URL — use the first one as the canonical frontend
const FRONTEND_URL =
  (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

function resolveBackendUrl(req) {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

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
    .insert([
      {
        user_id: userId,
        student_id: null,
        full_name:
          fallbackName || user?.full_name || user?.email?.split('@')[0] || null,
        status: 'active',
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return findStudent(userId);
    throw error;
  }
  return created;
}

// Paystack disabled route (kept for compatibility)
function bankTransferRequired(req, res) {
  return res.status(410).json({
    error:
      'Online Paystack payments are disabled. Please use the school bank account shown in your payment details.',
    paymentMethod: 'bank_transfer',
    bank: SCHOOL_BANK,
  });
}

// ============================================================
// GET /api/payments/bank-details
// Public-ish — returns the school bank account for manual transfers.
// ============================================================
async function getBankDetails(req, res) {
  try {
    // Optionally pull a student's latest admission to attach context
    const userId = req.user?.id;
    let student = null;
    let latestAdmission = null;

    if (userId) {
      student = await findStudent(userId);
      if (student) {
        const { data: admRows } = await supabaseAdmin
          .from('admissions')
          .select('id, status, course, track_name, created_at')
          .eq('student_id', student.id)
          .order('created_at', { ascending: false })
          .limit(1);
        latestAdmission = admRows?.[0] || null;
      }
    }

    return res.json({
      success: true,
      bank: SCHOOL_BANK,
      student: student
        ? {
            id: student.id,
            full_name: student.full_name,
            student_id: student.student_id,
          }
        : null,
      admission: latestAdmission,
    });
  } catch (error) {
    console.error('❌ getBankDetails error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch bank details' });
  }
}

// ============================================================
// POST /api/payments/bank-transfer
// Student has manually transferred money to the school account and
// submits proof of payment. We create a PENDING payment row that an
// admin can later approve.
//
// Correct behaviour:
//   ✅ Allows renewals — an "approved" admission no longer blocks
//   ✅ Returns an existing PENDING transfer instead of erroring
//   ✅ Allows resubmission if the last transfer was rejected/failed
//   ❌ Only blocks when we can't figure out who the student is
// ============================================================
async function submitBankTransfer(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const {
      amount,
      plan,
      course,          // campus
      trackName,
      studentName,
      reference,       // bank reference / teller number (optional)
      transferDate,    // YYYY-MM-DD (optional)
      proofUrl,        // uploaded receipt URL (optional)
      notes,           // free-form note (optional)
    } = req.body || {};

    // ── Validate amount ──
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
      return res
        .status(400)
        .json({ error: 'A valid amount (₦1 or more) is required' });
    }

    // ── Ensure student ──
    const student = await ensureStudent(userId, studentName);
    if (!student) {
      return res
        .status(404)
        .json({ error: 'Could not resolve your student record.' });
    }

    // ── Check for an existing PENDING bank transfer ──
    // If one exists, return it instead of creating a duplicate.
    const { data: pendingRows, error: pendingErr } = await supabaseAdmin
      .from('payments')
      .select(
        'id, payment_id, reference, amount, plan, status, payment_date, created_at'
      )
      .eq('student_id', student.id)
      .eq('payment_type', 'bank_transfer')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (pendingErr) {
      console.warn('⚠️ Could not check pending transfers:', pendingErr.message);
    }

    if (pendingRows && pendingRows.length > 0) {
      // An identical pending submission — return it as-is
      const sameAmount =
        Math.abs(Number(pendingRows[0].amount) - numericAmount) < 0.5;

      if (sameAmount) {
        return res.json({
          success: true,
          existing: true,
          message:
            'You already have a pending bank transfer for this amount. We will notify you once it is approved.',
          payment: pendingRows[0],
          bank: SCHOOL_BANK,
        });
      }

      // Different amount — student is likely paying for something else.
      // Mark the old one as cancelled and create a fresh one below.
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', pendingRows[0].id);
    }

    // ── Create the new pending bank transfer row ──
    const now = new Date().toISOString();
    const paymentId = `BT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const internalReference =
      reference?.trim() ||
      `BT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const row = {
      student_id: student.id,
      payment_id: paymentId,
      reference: internalReference,
      amount: numericAmount,
      currency: 'NGN',
      plan: plan || 'termly',
      course: course || null,
      payment_type: 'bank_transfer',
      description:
        [course, trackName].filter(Boolean).join(' · ') ||
        'School fees (bank transfer)',
      status: 'pending',
      created_at: now,
      updated_at: now,
      // Extra fields — safe to include even if the column doesn't exist,
      // Supabase silently ignores unknown columns only if they're set to null.
      // If your payments table doesn't have these, they'll just be dropped:
      transfer_date: transferDate || null,
      proof_url: proofUrl || null,
      notes: notes || null,
    };

    const { data: payment, error: insertErr } = await supabaseAdmin
      .from('payments')
      .insert([row])
      .select()
      .single();

    if (insertErr) {
      // If specific columns don't exist, retry without them
      console.warn(
        '⚠️ Insert with extra columns failed, retrying minimal row:',
        insertErr.message
      );

      const minimalRow = {
        student_id: student.id,
        payment_id: paymentId,
        reference: internalReference,
        amount: numericAmount,
        currency: 'NGN',
        plan: plan || 'termly',
        course: course || null,
        payment_type: 'bank_transfer',
        description:
          [course, trackName].filter(Boolean).join(' · ') ||
          'School fees (bank transfer)',
        status: 'pending',
        created_at: now,
      };

      const { data: payment2, error: insertErr2 } = await supabaseAdmin
        .from('payments')
        .insert([minimalRow])
        .select()
        .single();

      if (insertErr2) {
        console.error('❌ submitBankTransfer insert error:', insertErr2.message);
        return res.status(500).json({
          error: 'Failed to save bank transfer',
          details: insertErr2.message,
        });
      }

      return res.status(201).json({
        success: true,
        message:
          'Bank transfer submitted. An admin will verify and approve your payment.',
        payment: payment2,
        bank: SCHOOL_BANK,
      });
    }

    return res.status(201).json({
      success: true,
      message:
        'Bank transfer submitted. An admin will verify and approve your payment.',
      payment,
      bank: SCHOOL_BANK,
    });
  } catch (error) {
    console.error('❌ submitBankTransfer error:', error.message);
    return res.status(500).json({
      error: 'Failed to submit bank transfer',
      details: error.message,
    });
  }
}

// ============================================================
// POST /api/payments/initialize (Paystack — currently disabled)
// ============================================================
async function initializePayment(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { amount, email, course, trackName, plan, studentName } =
      req.body;

    if (!amount || !email) {
      return res.status(400).json({ error: 'Amount and email are required' });
    }

    const amountInKobo = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountInKobo) || amountInKobo < 100) {
      return res.status(400).json({ error: 'Amount must be at least ₦1' });
    }

    const student = await ensureStudent(userId, studentName);

    const backendUrl = resolveBackendUrl(req);
    const callbackUrl = `${backendUrl}/api/payments/verify`;

    const params = {
      email,
      amount: amountInKobo,
      callback_url: callbackUrl,
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
      .insert([
        {
          student_id: student.id,
          payment_id: paymentId,
          reference,
          amount: Number(amount),
          currency: 'NGN',
          plan: plan || 'termly',
          course: course || null,
          payment_type: 'school_fees',
          description:
            [course, trackName].filter(Boolean).join(' · ') || null,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
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
      return res.redirect(`${FRONTEND_URL}/login?error=missing_reference`);
    }

    const response = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      }
    );

    const payload = response.data;
    if (!payload?.status || !payload?.data) {
      return res.redirect(
        `${FRONTEND_URL}/login?error=verification_failed&reference=${encodeURIComponent(reference)}`
      );
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
      ? `/login?registered=true&reference=${encodeURIComponent(reference)}`
      : `/payment/failed?reference=${encodeURIComponent(reference)}`;

    return res.redirect(`${FRONTEND_URL}${redirectPath}`);
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    console.error('❌ verifyPayment error:', detail);
    return res.redirect(
      `${FRONTEND_URL}/login?error=verification_error&reference=${encodeURIComponent(
        req.query.reference || ''
      )}`
    );
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

    await supabaseAdmin.from('invoices').insert([
      {
        student_id: studentId,
        payment_id: paymentRow.payment_id,
        invoice_number: invoiceNumber,
        amount: paymentRow.amount,
        status: 'paid',
        items: [
          {
            description: paymentRow.description || 'Programme fee',
            amount: paymentRow.amount,
          },
        ],
        created_at: new Date().toISOString(),
      },
    ]);
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

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  bankTransferRequired,
  getBankDetails,
  submitBankTransfer,
  initializePayment,
  verifyPayment,
  paystackWebhook,
  getPaymentHistory,
  getInvoices,
};