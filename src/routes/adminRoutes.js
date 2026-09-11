const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Apply admin middleware to all routes
router.use(authenticateToken, requireAdmin);

// Student management
router.get('/students', adminController.getStudents);
router.get('/students/:studentId', adminController.getStudentDetails);
router.put('/students/:studentId', adminController.updateStudent);
router.delete('/students/:studentId', adminController.deleteStudent);

// Programme management
router.get('/programmes', adminController.getProgrammes);
router.post('/programmes', adminController.createProgramme);
router.put('/programmes/:programmeId', adminController.updateProgramme);
router.delete('/programmes/:programmeId', adminController.deleteProgramme);

// Dashboard stats
router.get('/stats', adminController.getStats);

module.exports = router;