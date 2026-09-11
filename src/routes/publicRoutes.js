const express = require('express');
const controller = require('../controllers/publicController');
const router = express.Router();
router.post('/applications', controller.createApplication);
router.post('/payments', controller.createPayment);
router.post('/contact', controller.contact);
router.post('/newsletter', controller.newsletter);
module.exports = router;
