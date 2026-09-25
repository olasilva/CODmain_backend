// src/routes/staffRoutes.js
const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const notificationController = require('../controllers/notificationController'); // ← NEW
const { authenticateToken, requireStaffOrAdmin } = require('../middleware/auth');

// Every staff route requires staff or admin
router.use(authenticateToken, requireStaffOrAdmin);

// ─── Profile / dashboard ───
router.get('/me', staffController.getMe);
router.get('/stats', staffController.getStats);

// ─── Students ───
router.get('/students', staffController.getStudents);
router.get('/students/:studentId', staffController.getStudentDetails);

// ─── Results entry ───
router.post('/students/:studentId/scores', staffController.submitScores);
router.post('/students/:studentId/submit-results', staffController.submitResults);

// ─── Assignments ───
router.get('/assignments', staffController.getAssignments);
router.post('/assignments', staffController.createAssignment);
router.get('/submissions/:assignmentId', staffController.getSubmissions);

// ─── Messages ───
router.get('/inbox', staffController.getInbox);
router.get('/messages/:studentId', staffController.getConversation);
router.post('/messages', staffController.sendMessage);

// ─── Attendance ───
router.get('/attendance/submissions', staffController.getAttendanceSubmissions);
router.get('/attendance/students', staffController.getAttendanceStudents);
router.get('/attendance/history', staffController.getAttendanceHistory);
router.post('/attendance', staffController.markAttendance);

// ─── Notifications (NEW) ───
router.get('/notifications', notificationController.getStaffNotifications);
router.put('/notifications/read-all', notificationController.markAllStaffNotificationsRead);
router.put('/notifications/:id/read', notificationController.markStaffNotificationRead);

module.exports = router;