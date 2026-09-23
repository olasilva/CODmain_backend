// src/routes/adminRoutes.js
const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin role
router.use(authenticateToken, requireAdmin);

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════
router.get('/stats', adminController.getStats);

// ═══════════════════════════════════════════════════════════════
// Students
// ═══════════════════════════════════════════════════════════════
router.get('/students', adminController.getStudents);
router.get('/students/:studentId', adminController.getStudentDetails);
router.put('/students/:studentId', adminController.updateStudent);
router.delete('/students/:studentId', adminController.deleteStudent);

// ═══════════════════════════════════════════════════════════════
// Report cards
// ═══════════════════════════════════════════════════════════════
router.get('/students/:studentId/report-cards', adminController.getStudentReportCards);
router.get('/students/:studentId/report-cards/:session/:term', adminController.getReportCard);
router.post('/students/:studentId/report-cards', adminController.upsertReportCard);

// ═══════════════════════════════════════════════════════════════
// Programmes
// ═══════════════════════════════════════════════════════════════
router.get('/programmes', adminController.getProgrammes);
router.post('/programmes', adminController.createProgramme);
router.put('/programmes/:programmeId', adminController.updateProgramme);
router.delete('/programmes/:programmeId', adminController.deleteProgramme);

// ═══════════════════════════════════════════════════════════════
// Classes + Tracks
// ═══════════════════════════════════════════════════════════════
router.get('/classes', adminController.getClasses);
router.get('/tracks', adminController.getTracks);

// ═══════════════════════════════════════════════════════════════
// Staff
// NOTE: more-specific routes are declared first so Express
// doesn't accidentally match a shorter pattern.
// ═══════════════════════════════════════════════════════════════
router.get('/staff', adminController.getStaff);
router.get('/staff/:staffId/classes', adminController.getStaffClasses);
router.post('/staff/:staffId/assign', adminController.assignStaffToClasses);
router.get('/staff/:staffId/password', adminController.getStaffPassword);
router.post('/staff/:staffId/reset-password', adminController.resetStaffPassword);
router.get('/staff/:staffId', adminController.getStaffDetails);
router.put('/staff/:staffId', adminController.updateStaff);
router.delete('/staff/:staffId', adminController.deleteStaff);

// ═══════════════════════════════════════════════════════════════
// Payments
// ═══════════════════════════════════════════════════════════════
router.get('/payments', adminController.getPayments);

// ═══════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════
router.get('/reports', adminController.getReports);

// ═══════════════════════════════════════════════════════════════
// Blog / News
// ═══════════════════════════════════════════════════════════════
router.get('/news', adminController.getNews);
router.post('/news', adminController.createNews);
router.put('/news/:newsId', adminController.updateNews);
router.delete('/news/:newsId', adminController.deleteNews);

module.exports = router;