// src/routes/sessionRoutes.js
const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { authenticateToken } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════
// STAFF — online session management
// ═══════════════════════════════════════════════════════════════

// Create a new online session
router.post(
  '/staff/sessions',
  authenticateToken,
  sessionController.createSession
);

// List sessions created by the logged-in staff
router.get(
  '/staff/sessions',
  authenticateToken,
  sessionController.getStaffSessions
);

// Update a session (title, time, link, status…)
router.put(
  '/staff/sessions/:id',
  authenticateToken,
  sessionController.updateSession
);

// Delete a session
router.delete(
  '/staff/sessions/:id',
  authenticateToken,
  sessionController.deleteSession
);

// ═══════════════════════════════════════════════════════════════
// STUDENT — view their scheduled sessions
// ═══════════════════════════════════════════════════════════════

router.get(
  '/student/sessions',
  authenticateToken,
  sessionController.getStudentSessions
);

module.exports = router;