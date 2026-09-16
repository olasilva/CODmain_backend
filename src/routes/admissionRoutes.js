// src/routes/admissionRoutes.js
const express = require('express');
const router = express.Router();
const admissionController = require('../controllers/admissionController');
const { authenticateToken } = require('../middleware/auth');

// ─── Public ───
router.get('/programmes', admissionController.getProgrammes);
router.get('/programmes/:programmeId', admissionController.getProgrammeById);

// ─── Authenticated ───
router.post('/start', authenticateToken, admissionController.startAdmission);
router.get('/status', authenticateToken, admissionController.getAdmissionStatus);
router.post(
  '/:admissionId/documents',
  authenticateToken,
  admissionController.submitDocuments
);

module.exports = router;