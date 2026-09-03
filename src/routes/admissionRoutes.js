const express = require('express');
const admissionController = require('../controllers/admissionController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/start', authenticateToken, admissionController.startAdmission);
router.get('/status', authenticateToken, admissionController.getAdmissionStatus);
router.post('/:admissionId/documents', authenticateToken, admissionController.submitDocuments);
router.get('/programmes', authenticateToken, admissionController.getProgrammes);

module.exports = router;