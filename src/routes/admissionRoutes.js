const express = require('express');
const admissionController = require('../controllers/admissionController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============ PUBLIC ROUTES ============

// GET /api/admissions - Root endpoint (for testing)
router.get('/', (req, res) => {
  res.json({
    message: 'Admissions API',
    endpoints: [
      { path: '/api/admissions/programmes', method: 'GET', description: 'Get all programmes' },
      { path: '/api/admissions/start', method: 'POST', description: 'Start a new admission' },
      { path: '/api/admissions/status', method: 'GET', description: 'Get admission status' },
      { path: '/api/admissions/:admissionId/documents', method: 'POST', description: 'Submit documents' },
      { path: '/api/admissions/apply', method: 'POST', description: 'Apply for admission (alternative)' }
    ]
  });
});

// GET /api/admissions/programmes - Get all programmes (public)
router.get('/programmes', admissionController.getProgrammes);

// ============ PROTECTED ROUTES ============

// POST /api/admissions/start - Start a new admission
router.post('/start', authenticateToken, admissionController.startAdmission);

// POST /api/admissions/apply - Alternative start admission (for frontend compatibility)
router.post('/apply', authenticateToken, admissionController.startAdmission);

// POST /api/admissions - Alternative root POST (for frontend compatibility)
router.post('/', authenticateToken, admissionController.startAdmission);

// GET /api/admissions/status - Get admission status
router.get('/status', authenticateToken, admissionController.getAdmissionStatus);

// POST /api/admissions/:admissionId/documents - Submit documents
router.post('/:admissionId/documents', authenticateToken, admissionController.submitDocuments);

module.exports = router;