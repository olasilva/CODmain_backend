// src/routes/adminRoutes.js
const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const contactController = require('../controllers/contactController');

const router = express.Router();

// All admin routes require auth + admin role
router.use(authenticateToken, requireAdmin);

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════
router.get('/stats', adminController.getStats);

// ═══════════════════════════════════════════════════════════════
// Contact inbox
// ═══════════════════════════════════════════════════════════════
router.get('/contact-messages', contactController.listMessages);
router.put('/contact-messages/:id/read', contactController.markRead);
router.post('/contact-messages/:id/reply', contactController.replyToMessage);
router.delete('/contact-messages/:id', contactController.deleteMessage);

// ═══════════════════════════════════════════════════════════════
// Students
// ═══════════════════════════════════════════════════════════════
router.get('/students', adminController.getStudents);

// ─── Global ID-card requests ───
router.get('/id-card-requests', adminController.getIdCardRequests);
router.post('/id-card-requests/:requestId/approve', adminController.approveIdCardRequest);
router.post('/id-card-requests/:requestId/reject', adminController.rejectIdCardRequest);

// ─── Per-student ID-card requests ───
// NOTE: these must come BEFORE the generic '/students/:studentId'
router.get(
  '/students/:studentId/id-card-requests',
  adminController.getStudentIdCardRequests
);
router.post(
  '/students/:studentId/id-card-requests/:requestId/approve',
  adminController.approveStudentIdCardRequest
);

// ─── Student CRUD ───
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
// Admissions
// ═══════════════════════════════════════════════════════════════
router.get('/admissions', adminController.getAdmissions);
router.get('/admission-reviews', adminController.getAdmissionReviewQueue);

router.put('/admissions/:admissionId/status', (req, res) => {
  const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
  if (['approved', 'admitted', 'accepted'].includes(requestedStatus)) {
    return adminController.approveAdmission(req, res);
  }
  if (requestedStatus === 'rejected') {
    return adminController.rejectAdmission(req, res);
  }
  return res.status(400).json({
    error: 'status must be approved, admitted, accepted, or rejected',
  });
});

router
  .route('/admissions/:admissionId/approve')
  .post(adminController.approveAdmission)
  .put(adminController.approveAdmission)
  .patch(adminController.approveAdmission);

router
  .route('/admissions/:admissionId/reject')
  .post(adminController.rejectAdmission)
  .put(adminController.rejectAdmission);

// ═══════════════════════════════════════════════════════════════
// Payments
// ═══════════════════════════════════════════════════════════════
router.get('/payments', adminController.getPayments);

// Approve a bank-transfer payment row. Delegates to
// adminController.approveBankTransfer, which:
//   – marks the payment completed
//   – finds the linked admission by student_id
//   – approves the admission
//   – sends the confirmation email
router
  .route('/payments/:paymentId/approve')
  .post(adminController.approveBankTransfer)
  .put(adminController.approveBankTransfer)
  .patch(adminController.approveBankTransfer);

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