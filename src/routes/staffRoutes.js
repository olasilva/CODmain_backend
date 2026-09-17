// src/routes/staffRoutes.js
const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { authenticateToken, requireStaffOrAdmin } = require('../middleware/auth');

// Every staff route requires staff or admin
router.use(authenticateToken, requireStaffOrAdmin);

// Profile / dashboard
router.get('/me', staffController.getMe);
router.get('/stats', staffController.getStats);

// Students
router.get('/students', staffController.getStudents);
router.get('/students/:studentId', staffController.getStudentDetails);

// Results entry
router.post('/students/:studentId/scores', staffController.submitScores);
router.post('/students/:studentId/submit-results', staffController.submitResults);

// Assignments
router.get('/assignments', staffController.getAssignments);
router.post('/assignments', staffController.createAssignment);
router.get('/submissions/:assignmentId', staffController.getSubmissions);

// Messages
router.get('/inbox', staffController.getInbox);
router.get('/messages/:studentId', staffController.getConversation);
router.post('/messages', staffController.sendMessage);

module.exports = router;