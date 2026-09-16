// src/routes/authRoutes.js
const express = require('express');
const passport = require('passport');
const controller = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public
router.post('/register', controller.register);
router.post('/login', controller.login);
router.post('/google', controller.googleLogin);

// Google OAuth redirect flow
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', session: false }),
  controller.googleCallback
);

// Protected
router.get('/profile', authenticateToken, controller.getProfile);
router.put('/profile', authenticateToken, controller.updateProfile);
router.post('/change-password', authenticateToken, controller.changePassword);
router.post('/logout', authenticateToken, controller.logout);

// Admin-only: create staff
router.post('/staff', authenticateToken, requireAdmin, controller.createStaff);

module.exports = router;