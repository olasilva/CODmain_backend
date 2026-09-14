// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

// Authenticated — user starts a Paystack payment
router.post('/initialize', authenticateToken, paymentController.initializePayment);

// Public — Paystack redirects the user's browser here (no JWT)
router.get('/verify', paymentController.verifyPayment);

// Public — Paystack posts server-to-server (signature is verified inside)
router.post('/webhook', paymentController.paystackWebhook);

// Authenticated — payment history and invoices
router.get('/history', authenticateToken, paymentController.getPaymentHistory);
router.get('/invoices', authenticateToken, paymentController.getInvoices);

module.exports = router;