const express = require('express');
const router = express.Router();
const { verifyPlatformInbound } = require('../middlewares/platformAuth');
const controller = require('../controllers/platformInternal.controller');

router.use(verifyPlatformInbound);
router.get('/health', controller.health);
router.post('/license/validate', controller.validateLicense);
router.post('/support-tickets', controller.submitSupportTicket);

module.exports = router;
