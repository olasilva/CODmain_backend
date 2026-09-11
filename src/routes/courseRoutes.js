const express = require('express');
const controller = require('../controllers/genericController');
const router = express.Router();
router.get('/', controller.list('courses'));
router.get('/:courseId', controller.list('course'));
module.exports = router;
