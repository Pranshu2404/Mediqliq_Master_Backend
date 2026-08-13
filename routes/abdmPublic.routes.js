const router = require('express').Router();
const controller = require('../controllers/abdmPublic.controller');
const verify = require('../middlewares/verifyAbdmCallback');
const config = require('../config/abdm.config');
// Direct HIP -> HIU encrypted data transfer uses an expiring, unguessable relay token.
router.post('/hiu/health-information/data/:relayToken', controller.hiuDataRelay);
router.use(verify);
if (config.featureM2) {
  router.post('/hip/patient/share', controller.profileShare);
  router.post('/hip/token/on-generate-token', controller.linkTokenCallback);
  router.post('/hip/token/ongeneratetoken', controller.linkTokenCallback);
  router.post('/link/on_carecontext', controller.linkCareContextCallback);
  router.post('/links/context/on-notify', controller.careContextUpdateCallback);
  router.post('/links/context/onnotify', controller.careContextUpdateCallback);
  router.post('/patients/sms/on-notify', controller.smsNotifyCallback);
  router.post('/patients/sms/onnotify', controller.smsNotifyCallback);
  router.post('/hip/patient-share/running-token/status', controller.runningTokenStatus);
  router.post('/hip/running-token/status', controller.runningTokenStatus);
  router.post('/hip/patient/care-context/discover', controller.userDiscovery);
  router.post('/hip/patient/carecontext/discover', controller.userDiscovery);
  router.post('/hip/link/care-context/init', controller.userLinkInit);
  router.post('/hip/link/carecontext/init', controller.userLinkInit);
  router.post('/hip/link/care-context/confirm', controller.userLinkConfirm);
  router.post('/hip/link/carecontext/confirm', controller.userLinkConfirm);
  router.post('/consent/request/hip/notify', controller.consentNotify);
  router.post('/hip/health-information/request', controller.healthInformationRequest);
}
if (config.featureM3) {
  router.post('/hiu/consent/request/on-init', controller.hiuConsentOnInit);
  router.post('/hiu/consent/request/oninit', controller.hiuConsentOnInit);
  router.post('/hiu/consent/request/notify', controller.hiuConsentNotify);
  router.post('/hiu/consent/request/on-status', controller.hiuConsentOnStatus);
  router.post('/hiu/consent/request/onstatus', controller.hiuConsentOnStatus);
  router.post('/hiu/consent/on-fetch', controller.hiuConsentOnFetch);
  router.post('/hiu/consent/onfetch', controller.hiuConsentOnFetch);
  router.post('/hiu/health-information/on-request', controller.hiuHealthInformationOnRequest);
  router.post('/hiu/health-information/onrequest', controller.hiuHealthInformationOnRequest);
  router.post('/hiu/health-information/data', controller.hiuDataPush);
  router.post('/hiu/data', controller.hiuDataPush);
  // PHR/Patient HIU callbacks for user-initiated discovery and care-context linking.
  router.post('/hiu/patient/care-context/on-discover', controller.hiuPatientCareContextOnDiscover);
  router.post('/hiu/patient/carecontext/on-discover', controller.hiuPatientCareContextOnDiscover);
  router.post('/hiu/patient/care-context/on-init', controller.hiuPatientCareContextOnInit);
  router.post('/hiu/patient/carecontext/on-init', controller.hiuPatientCareContextOnInit);
  router.post('/hiu/patient/care-context/on-confirm', controller.hiuPatientCareContextOnConfirm);
  router.post('/hiu/patient/carecontext/on-confirm', controller.hiuPatientCareContextOnConfirm);
  if (config.featureSubscriptions) {
    router.post('/hiu/hiecm/subscription-requests/on-init', controller.hiuSubscriptionOnInit);
    router.post('/hiu/subscription-requests/hiu/notify', controller.hiuSubscriptionNotify);
    router.post('/hiu/subscription/notify', controller.hiuCareContextNotify);
  }
}
module.exports = router;
