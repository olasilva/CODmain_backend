const express = require('express');
const courseMaterialController = require('../controllers/coursematerialController');
const { authenticateToken, requireStaffOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Public (authenticated) routes
router.get('/:classId', authenticateToken, courseMaterialController.getMaterials);
router.get('/:classId/:materialId', authenticateToken, courseMaterialController.getMaterial);

// Staff/Admin routes
router.use(authenticateToken, requireStaffOrAdmin);
router.post('/', courseMaterialController.createMaterial);
router.put('/:materialId', courseMaterialController.updateMaterial);
router.delete('/:materialId', courseMaterialController.deleteMaterial);

module.exports = router;