// src/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public upload — used during registration before a JWT exists
router.post('/avatar-public', uploadController.uploadAvatarPublic);

// Authenticated upload — current user's own avatar
router.post('/avatar', authenticateToken, uploadController.uploadAvatar);

// Admin — upload a blog cover image
router.post(
  '/blog-cover',
  authenticateToken,
  requireAdmin,
  uploadController.uploadBlogCover
);

module.exports = router;