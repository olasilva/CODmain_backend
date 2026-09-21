// src/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const newsController = require('../controllers/newsController');

router.get('/', newsController.getNews);
router.get('/:slug', newsController.getNewsBySlug);

module.exports = router;