const express = require('express');
const controller = require('../controllers/genericController');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken);
router.get('/', controller.list('results'));
router.get('/:resultId', controller.list('result'));
module.exports = router;
