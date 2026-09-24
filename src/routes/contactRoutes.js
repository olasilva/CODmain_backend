// src/routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

// PUBLIC — no auth required
router.post('/', contactController.submitMessage);

module.exports = router;