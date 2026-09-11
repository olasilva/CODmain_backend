const express = require('express');
const staffController = require('../controllers/staffController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All staff routes require admin authentication
router.use(authenticateToken, requireAdmin);

router.get('/', staffController.getAllStaff);
router.get('/:staffId', staffController.getStaffById);
router.post('/', staffController.createStaff);
router.put('/:staffId', staffController.updateStaff);
router.delete('/:staffId', staffController.deleteStaff);
router.get('/stats', staffController.getStats);

module.exports = router;