// src/routes/adminRoutes.js
const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Apply admin middleware to all routes
router.use(authenticateToken, requireAdmin);

// ─── Dashboard ───
router.get('/stats', adminController.getStats);

// ─── Student management ───
router.get('/students', adminController.getStudents);
router.get('/students/:studentId', adminController.getStudentDetails);
router.put('/students/:studentId', adminController.updateStudent);
router.delete('/students/:studentId', adminController.deleteStudent);

// ─── Report cards ───
router.get('/students/:studentId/report-cards', adminController.getStudentReportCards);
router.get('/students/:studentId/report-cards/:session/:term', adminController.getReportCard);
router.post('/students/:studentId/report-cards', adminController.upsertReportCard);

// ─── Programme management ───
router.get('/programmes', adminController.getProgrammes);
router.post('/programmes', adminController.createProgramme);
router.put('/programmes/:programmeId', adminController.updateProgramme);
router.delete('/programmes/:programmeId', adminController.deleteProgramme);

// ─── Payments ───
router.get('/payments', adminController.getPayments);

// ─── Reports ───
router.get('/reports', adminController.getReports);

module.exports = router;