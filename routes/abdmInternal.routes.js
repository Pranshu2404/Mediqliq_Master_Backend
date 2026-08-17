const router = require('express').Router();
const controller = require('../controllers/abdmInternal.controller');
const { verifyMasterInbound } = require('../middlewares/internalAbdmAuth');
const sharedController = require('../controllers/abdmSharedServices.controller');
const { sharedAbdmServiceGuard } = require('../middlewares/sharedAbdmServiceGuard');
router.use(verifyMasterInbound);
router.get('/health', controller.health);
router.get('/facility-status', controller.facilityStatus);
router.post('/dependency-status', controller.dependencyStatus);

// Shared private ABDM compute. All routes inherit verifyMasterInbound above, so
// tenant/facility identity always comes from the hospital connector signature.
router.get('/shared/health', sharedAbdmServiceGuard('HEALTH'), sharedController.health);
router.post('/shared/fhir/validate', sharedAbdmServiceGuard('FHIR'), sharedController.validateFhir);
router.post('/shared/crypto/receiver-key-material', sharedAbdmServiceGuard('CRYPTO'), sharedController.generateReceiverKeyMaterial);
router.post('/shared/crypto/encrypt', sharedAbdmServiceGuard('CRYPTO'), sharedController.encrypt);
router.post('/shared/crypto/decrypt', sharedAbdmServiceGuard('CRYPTO'), sharedController.decrypt);
router.post('/shared/consent/validate', sharedAbdmServiceGuard('CONSENT'), sharedController.validateConsent);
router.post('/shared/consent/usage/:action', sharedAbdmServiceGuard('CONSENT'), sharedController.consentUsage);
router.post('/shared/consent/status-events', sharedAbdmServiceGuard('CONSENT'), sharedController.consentStatusEvent);
router.post('/proxy/abha', controller.proxyAbha);
router.post('/m1/proxy', controller.proxyAbha);
router.post('/hip/action', controller.hipAction);
router.post('/m2/action', controller.hipAction);
router.post('/m2/retry-link-callback', controller.retryM2LinkCallback);
router.post('/hiu/action', controller.hiuAction);
router.post('/m3/action', controller.hiuAction);
router.post('/m3/data-relay-token', controller.createDataRelayToken);
module.exports = router;
