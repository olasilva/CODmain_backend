const express = require('express');
const controller = require('../controllers/genericController');
const router = express.Router();
router.get('/', controller.list('news'));
router.get('/:slug', controller.list('news post'));
module.exports = router;
