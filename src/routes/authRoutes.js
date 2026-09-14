// src/routes/authRoutes.js
const express = require('express');
const passport = require('passport');
const controller = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============ PUBLIC ROUTES ============

router.post('/register', controller.register);
router.post('/login', controller.login);
router.post('/google', controller.googleLogin); // ID token flow

// ── Google OAuth Redirect Flow ──

// 1. Start the OAuth flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// 2. Google redirects back here
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    session: false,
  }),
  controller.googleCallback
);

// ============ PROTECTED ROUTES ============

router.get('/profile', authenticateToken, controller.getProfile);
router.put('/profile', authenticateToken, controller.updateProfile);
router.post('/change-password', authenticateToken, controller.changePassword);
router.post('/logout', authenticateToken, controller.logout);

// ============ ADMIN-ONLY ROUTES ============

/**
 * POST /api/auth/staff
 * Admin creates a staff account.
 * Backend generates the password, emails it to the staff member,
 * and returns the plaintext password to the admin once.
 */
router.post(
  '/staff',
  authenticateToken,
  requireAdmin,
  controller.createStaff
);

module.exports = router;