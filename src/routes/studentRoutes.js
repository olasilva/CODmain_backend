// src/routes/studentRoutes.js
const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const notificationController = require('../controllers/notificationController');
const messageController = require('../controllers/messageController');
const settingsController = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');

// ─── Profile ───
router.get('/profile', authenticateToken, studentController.getProfile);
router.put('/profile', authenticateToken, studentController.updateProfile);

// ─── My programme & classes (from admission) ───
router.get('/my-programme', authenticateToken, studentController.getMyProgramme);
router.get('/my-classes', authenticateToken, studentController.getMyEnrolledClasses);

// ─── Attendance ───
router.get('/attendance', authenticateToken, studentController.getMyAttendance);
router.post('/attendance', authenticateToken, studentController.submitAttendance);

// ─── Fees ───
router.get('/fees', authenticateToken, studentController.getMyFees);

// ─── Courses (legacy, kept for compat) ───
router.get('/courses', authenticateToken, studentController.getCourses);
router.get('/courses/:courseId', authenticateToken, studentController.getCourseDetails);

// ─── Assignments ───
router.get('/assignments', authenticateToken, studentController.getAssignments);
router.get('/assignments/:assignmentId', authenticateToken, studentController.getAssignmentDetails);
router.post('/assignments/:assignmentId/submit', authenticateToken, studentController.submitAssignment);

// ─── Classes ───
router.get('/classes', authenticateToken, studentController.getClasses);
router.get('/classes/:classId', authenticateToken, studentController.getClassDetails);

// ─── Results ───
router.get('/results', authenticateToken, studentController.getResults);
router.get('/results/:resultId', authenticateToken, studentController.getResultDetails);

// ─── Payments ───
router.get('/payments', authenticateToken, studentController.getPayments);
router.get('/payments/:paymentId', authenticateToken, studentController.getPaymentDetails);

// ─── Notifications ───
router.get('/notifications', authenticateToken, notificationController.getNotifications);
router.put('/notifications/:notificationId/read', authenticateToken, notificationController.markAsRead);
router.put('/notifications/read-all', authenticateToken, notificationController.markAllAsRead);

// ─── Teacher messaging ───
// NOTE: specific paths must come BEFORE the generic /messages
router.get('/teachers', authenticateToken, studentController.getMyTeachers);
router.get('/messages/unread-count', authenticateToken, messageController.getUnreadCount);
router.put('/messages/:messageId/read', authenticateToken, messageController.markAsRead);
router.get('/messages/:teacherUserId', authenticateToken, studentController.getConversationWithTeacher);
router.post('/messages', authenticateToken, studentController.sendMessageToTeacher);

// ─── Settings ───
router.get('/settings', authenticateToken, settingsController.getSettings);
router.put('/settings', authenticateToken, settingsController.updateSettings);
router.put('/settings/privacy', authenticateToken, settingsController.updatePrivacy);

// ─── Materials ───
router.get('/materials/:classId', authenticateToken, studentController.getMaterials);
router.get('/materials/:classId/:materialId', authenticateToken, studentController.getMaterial);

module.exports = router;