const express = require('express');
const router = express.Router();
const controller = require('../controllers/electronEnrollment.controller');
router.post('/redeem', controller.redeem);
router.post('/complete', controller.complete);
module.exports = router;
