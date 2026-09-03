const express = require('express');
const controller = require('../controllers/genericController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken, requireAdmin);
router.get('/', controller.list('reports'));
router.post('/', controller.create('report'));
module.exports = router;
