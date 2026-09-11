const express = require('express');
const passport = require('passport'); // ADD THIS
const controller = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============ PUBLIC ROUTES ============

router.post('/register', controller.register);
router.post('/login', controller.login);
router.post('/google', controller.googleLogin); // For ID token flow (optional)

// --- Google OAuth Redirect Flow ---

// 1. Route to start the OAuth flow
router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'], 
  session: false 
}));

// 2. Route Google redirects back to
router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login', session: false }),
  controller.googleCallback
);

// ============ PROTECTED ROUTES ============

router.get('/profile', authenticateToken, controller.getProfile);
router.put('/profile', authenticateToken, controller.updateProfile);
router.post('/change-password', authenticateToken, controller.changePassword);
router.post('/logout', authenticateToken, controller.logout);

module.exports = router;