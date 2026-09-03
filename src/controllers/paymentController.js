const supabaseService = require('../services/supabaseService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');

class PaymentController {
  // Create payment intent
  async createPaymentIntent(req, res) {
    try {
      const userId = req.user.id;
      const { amount, paymentType, description, programmeId } = req.body;

      // Get student
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id, student_id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Create payment record
      const paymentId = `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`;
      
      const { data: payment, error } = await supabaseService.client
        .from('payments')
        .insert([{
          student_id: student.id,
          payment_id: paymentId,
          amount: amount,
          payment_type: paymentType,
          description: description,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        metadata: {
          paymentId: paymentId,
          studentId: student.student_id,
          studentUserId: userId
        },
        description: description
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentId: paymentId,
        amount: amount
      });
    } catch (error) {
      console.error('Create payment intent error:', error);
      res.status(500).json({ error: 'Failed to create payment' });
    }
  }

  // Webhook handler for Stripe
  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handleSuccessfulPayment(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handleFailedPayment(event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  }

  async handleSuccessfulPayment(paymentIntent) {
    try {
      const paymentId = paymentIntent.metadata.paymentId;
      const transactionId = paymentIntent.id;

      // Update payment status
      await supabaseService.client
        .from('payments')
        .update({
          status: 'completed',
          transaction_id: transactionId,
          payment_date: new Date().toISOString()
        })
        .eq('payment_id', paymentId);

      // Create invoice
      const invoiceNumber = `INV${Date.now()}`;
      const { data: payment } = await supabaseService.client
        .from('payments')
        .select('student_id, amount, description')
        .eq('payment_id', paymentId)
        .single();

      await supabaseService.client
        .from('invoices')
        .insert([{
          student_id: payment.student_id,
          invoice_number: invoiceNumber,
          amount: payment.amount,
          status: 'paid',
          items: [{ description: payment.description, amount: payment.amount }]
        }]);

      console.log(`Payment ${paymentId} processed successfully`);
    } catch (error) {
      console.error('Handle successful payment error:', error);
    }
  }

  async handleFailedPayment(paymentIntent) {
    try {
      const paymentId = paymentIntent.metadata.paymentId;

      await supabaseService.client
        .from('payments')
        .update({
          status: 'failed',
          transaction_id: paymentIntent.id
        })
        .eq('payment_id', paymentId);

      console.log(`Payment ${paymentId} failed`);
    } catch (error) {
      console.error('Handle failed payment error:', error);
    }
  }

  // Get payment history
  async getPaymentHistory(req, res) {
    try {
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: payments, error } = await supabaseService.client
        .from('payments')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json(payments);
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(500).json({ error: 'Failed to fetch payment history' });
    }
  }

  // Get invoices
  async getInvoices(req, res) {
    try {
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: invoices, error } = await supabaseService.client
        .from('invoices')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json(invoices);
    } catch (error) {
      console.error('Get invoices error:', error);
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  }
}

module.exports = new PaymentController();