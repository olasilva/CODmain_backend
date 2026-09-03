const express = require('express');
const studentController = require('../controllers/studentController');
const notificationController = require('../controllers/notificationController');
const messageController = require('../controllers/messageController');
const settingsController = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Profile
router.get('/profile', authenticateToken, studentController.getProfile);
router.put('/profile', authenticateToken, studentController.updateProfile);

// Courses
router.get('/courses', authenticateToken, studentController.getCourses);
router.get('/courses/:courseId', authenticateToken, studentController.getCourseDetails);

// Assignments
router.get('/assignments', authenticateToken, studentController.getAssignments);
router.get('/assignments/:assignmentId', authenticateToken, studentController.getAssignmentDetails);
router.post('/assignments/:assignmentId/submit', authenticateToken, studentController.submitAssignment);

// Classes
router.get('/classes', authenticateToken, studentController.getClasses);
router.get('/classes/:classId', authenticateToken, studentController.getClassDetails);

// Results
router.get('/results', authenticateToken, studentController.getResults);
router.get('/results/:resultId', authenticateToken, studentController.getResultDetails);

// Payments
router.get('/payments', authenticateToken, studentController.getPayments);
router.get('/payments/:paymentId', authenticateToken, studentController.getPaymentDetails);

// Notifications
router.get('/notifications', authenticateToken, notificationController.getNotifications);
router.put('/notifications/:notificationId/read', authenticateToken, notificationController.markAsRead);
router.put('/notifications/read-all', authenticateToken, notificationController.markAllAsRead);

// Messages
router.get('/messages', authenticateToken, messageController.getMessages);
router.post('/messages', authenticateToken, messageController.sendMessage);
router.put('/messages/:messageId/read', authenticateToken, messageController.markAsRead);
router.get('/messages/unread-count', authenticateToken, messageController.getUnreadCount);

// Settings
router.get('/settings', authenticateToken, settingsController.getSettings);
router.put('/settings', authenticateToken, settingsController.updateSettings);
router.put('/settings/privacy', authenticateToken, settingsController.updatePrivacy);

// Course Materials
router.get('/materials/:classId', authenticateToken, studentController.getMaterials);
router.get('/materials/:classId/:materialId', authenticateToken, studentController.getMaterial);

module.exports = router;