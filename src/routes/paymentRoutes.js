// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

// ─── Bank transfer (manual payment) ───
router.get(
  '/bank-details',
  authenticateToken,
  paymentController.getBankDetails
);

router.post(
  '/bank-transfer',
  authenticateToken,
  paymentController.submitBankTransfer
);

// ─── Paystack — retired. Online payments disabled ───
router.post(
  '/initialize',
  authenticateToken,
  paymentController.bankTransferRequired
);
router.get('/verify', paymentController.bankTransferRequired);
router.post('/webhook', paymentController.bankTransferRequired);

// ─── History & invoices ───
router.get(
  '/history',
  authenticateToken,
  paymentController.getPaymentHistory
);
router.get(
  '/invoices',
  authenticateToken,
  paymentController.getInvoices
);

module.exports = router;