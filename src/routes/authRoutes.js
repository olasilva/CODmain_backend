// src/routes/authRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const controller = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please try again later.' },
});

// Public
router.post('/register', controller.register);
router.post('/login', controller.login);
router.post('/google', controller.googleLogin);
router.post('/forgot-password', passwordResetLimiter, controller.requestPasswordReset);
router.post('/reset-password', passwordResetLimiter, controller.resetPassword);

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