const express = require('express');
const controller = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken);
router.get('/', controller.getSettings);
router.put('/', controller.updateSettings);
router.put('/privacy', controller.updatePrivacy);
module.exports = router;
