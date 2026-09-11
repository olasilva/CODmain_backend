const express = require('express');
const controller = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken);
router.get('/', controller.getNotifications);
router.put('/:notificationId/read', controller.markAsRead);
router.put('/read-all', controller.markAllAsRead);
module.exports = router;
