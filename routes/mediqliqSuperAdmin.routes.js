const express = require('express');
const router = express.Router();
const controller = require('../controllers/mediqliqSuperAdmin.controller');
const { protect, isMediQliqSuperAdmin } = require('../middlewares/masterAuth');
const abdmConfig = require('../config/abdm.config');
const abdmMasterController = require('../controllers/abdmMasterAdmin.controller');
const mediqliqAbdmController = require('../controllers/mediqliqAbdmAdmin.controller');
const hospitalController = require('../controllers/hospitalAdmin.controller');
const licenseController = require('../controllers/licenseAdmin.controller');
const planController = require('../controllers/planAdmin.controller');
const supportController = require('../controllers/supportTicketAdmin.controller');

const requireSuperAdmin = [protect, isMediQliqSuperAdmin];

// Public setup/auth routes
router.post('/auth/bootstrap', controller.bootstrapSuperAdmin);
router.post('/auth/login', controller.loginSuperAdmin);

// Profile
router.get('/me', requireSuperAdmin, controller.getMe);
router.patch('/me/password', requireSuperAdmin, controller.changePassword);

// Dashboard
router.get('/dashboard/stats', requireSuperAdmin, controller.getDashboardStats);


// ABDM master control plane. These routes reuse the logged-in MediQliq super-admin
// session so the static ABDM master admin key is never exposed to the browser.
if (abdmConfig.isMaster) {
  router.get('/abdm/overview', requireSuperAdmin, mediqliqAbdmController.getOverview);
  router.get('/abdm/shared-services/health', requireSuperAdmin, mediqliqAbdmController.getSharedServicesHealth);
  router.get('/abdm/phr-capabilities', requireSuperAdmin, mediqliqAbdmController.getPhrCapabilities);

  router.get('/abdm/gateway/health', requireSuperAdmin, abdmMasterController.gatewayHealth);
  router.patch('/abdm/gateway/bridge-url', requireSuperAdmin, abdmMasterController.updateBridge);
  router.get('/abdm/gateway/services', requireSuperAdmin, abdmMasterController.bridgeServices);

  router.post('/abdm/facilities', requireSuperAdmin, abdmMasterController.createFacility);
  router.get('/abdm/facilities', requireSuperAdmin, abdmMasterController.listFacilities);
  router.get('/abdm/facilities/:facilityId', requireSuperAdmin, abdmMasterController.getFacility);
  router.patch('/abdm/facilities/:facilityId', requireSuperAdmin, abdmMasterController.updateFacility);
  router.post(
    '/abdm/facilities/:facilityId/rotate-connector-secret',
    requireSuperAdmin,
    abdmMasterController.rotateConnectorSecret
  );
  router.post(
    '/abdm/facilities/:facilityId/check-connector',
    requireSuperAdmin,
    abdmMasterController.checkFacilityConnector
  );
  router.post('/abdm/facilities/:facilityId/verify-hfr', requireSuperAdmin, abdmMasterController.verifyHfrFacility);
  router.post('/abdm/facilities/:facilityId/verify-linkage', requireSuperAdmin, abdmMasterController.verifyFacilityLinkage);
  router.post('/abdm/facilities/:facilityId/tests/:testType', requireSuperAdmin, abdmMasterController.recordRolloutTest);
  router.post('/abdm/facilities/:facilityId/activate', requireSuperAdmin, abdmMasterController.activateFacility);

  router.get('/abdm/consents', requireSuperAdmin, mediqliqAbdmController.listConsents);
  router.get('/abdm/consents/:consentRecordId', requireSuperAdmin, mediqliqAbdmController.getConsent);
  router.get('/abdm/jobs', requireSuperAdmin, mediqliqAbdmController.listJobs);
  router.get('/abdm/jobs/:jobId', requireSuperAdmin, mediqliqAbdmController.getJob);
  router.get('/abdm/hiu-requests', requireSuperAdmin, mediqliqAbdmController.listHiuRequests);
  router.get('/abdm/hiu-requests/:requestId', requireSuperAdmin, mediqliqAbdmController.getHiuRequest);
  router.get('/abdm/subscriptions', requireSuperAdmin, mediqliqAbdmController.listSubscriptions);
  router.post('/abdm/jobs/:jobId/retry', requireSuperAdmin, abdmMasterController.retryJob);

  router.get('/abdm/transactions', requireSuperAdmin, abdmMasterController.transactions);
  router.get('/abdm/transactions/:transactionId', requireSuperAdmin, mediqliqAbdmController.getTransaction);
  router.get('/abdm/webhook-events', requireSuperAdmin, abdmMasterController.webhookEvents);
  router.get('/abdm/webhook-events/:eventId', requireSuperAdmin, mediqliqAbdmController.getWebhookEvent);
  router.post('/abdm/webhook-events/:eventId/replay', requireSuperAdmin, abdmMasterController.replayWebhookEvent);
}

// User management
router.get('/users', requireSuperAdmin, controller.listUsers);
router.post('/users', requireSuperAdmin, controller.createUser);
router.patch('/users/:userId', requireSuperAdmin, controller.updateUser);
router.delete('/users/:userId', requireSuperAdmin, controller.deleteUser);

// Hospital management / remote provisioning
router.get('/hospitals', requireSuperAdmin, hospitalController.listHospitals);
router.post('/hospitals', requireSuperAdmin, hospitalController.createHospital);
router.get('/hospitals/:hospitalId', requireSuperAdmin, hospitalController.getHospital);
router.patch('/hospitals/:hospitalId', requireSuperAdmin, hospitalController.updateHospital);
router.post('/hospitals/:hospitalId/provision', requireSuperAdmin, hospitalController.provisionHospital);
router.post('/hospitals/:hospitalId/platform-connector/rotate', requireSuperAdmin, hospitalController.rotatePlatformConnector);
router.post('/hospitals/:hospitalId/platform-connector/check', requireSuperAdmin, hospitalController.checkPlatformConnector);
router.delete('/hospitals/:hospitalId', requireSuperAdmin, hospitalController.deleteHospital);

// Plan management
router.get('/plans', requireSuperAdmin, planController.listPlans);
router.post('/plans', requireSuperAdmin, planController.createPlan);
router.get('/plans/:planId', requireSuperAdmin, planController.getPlan);
router.patch('/plans/:planId', requireSuperAdmin, planController.updatePlan);

// License management
router.get('/licenses', requireSuperAdmin, licenseController.listLicenses);
router.post('/licenses', requireSuperAdmin, licenseController.createLicense);
router.get('/licenses/:licenseId', requireSuperAdmin, licenseController.getLicense);
router.patch('/licenses/:licenseId', requireSuperAdmin, licenseController.updateLicense);
router.delete('/licenses/:licenseId', requireSuperAdmin, licenseController.deleteLicense);
router.patch('/licenses/:licenseId/reset-activations', requireSuperAdmin, licenseController.resetLicenseActivations);
router.delete('/licenses/:licenseId/activations/:activationId', requireSuperAdmin, licenseController.removeLicenseActivation);

// Central support ticket management
router.get('/support-tickets', requireSuperAdmin, supportController.listTickets);
router.get('/support-tickets/:ticketId', requireSuperAdmin, supportController.getTicket);
router.patch('/support-tickets/:ticketId', requireSuperAdmin, supportController.updateTicket);

// Audit logs
router.get('/audit-logs', requireSuperAdmin, controller.listAuditLogs);
router.get('/audit-logs/:auditLogId', requireSuperAdmin, controller.getAuditLog);
router.delete('/audit-logs/prune/old', requireSuperAdmin, controller.pruneAuditLogs);

module.exports = router;
