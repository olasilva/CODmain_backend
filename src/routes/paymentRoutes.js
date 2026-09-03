const express = require('express');
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/create-intent', authenticateToken, paymentController.createPaymentIntent);
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);
router.get('/history', authenticateToken, paymentController.getPaymentHistory);
router.get('/invoices', authenticateToken, paymentController.getInvoices);

module.exports = router;