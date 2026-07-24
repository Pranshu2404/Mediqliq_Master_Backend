const crypto = require('crypto');
const config = require('../config/abdm.config');
const { hiecmRequest } = require('./abdmHttp.service');

function headers(hiuId, extra = {}) { return { 'X-HIU-ID': hiuId, 'X-CM-ID': config.cmId, ...extra }; }
function post(path, hiuId, body, requestId = crypto.randomUUID()) {
  return hiecmRequest(path, { method: 'POST', body, headers: headers(hiuId), requestId }).then((data) => ({ requestId, data }));
}
module.exports = {
  initiateConsent: (id, body, r) => post('/consent/v3/request/init', id, body, r),
  consentStatus: (id, body, r) => post('/consent/v3/request/status', id, body, r),
  fetchConsent: (id, body, r) => post('/consent/v3/fetch', id, body, r),
  acknowledgeConsentNotify: (id, body, r) => post('/consent/v3/request/hiu/on-notify', id, body, r),
  requestHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/request', id, body, r),
  notifyHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/notify', id, body, r),
  initiateSubscription: (id, body, r) => post('/subscription-requests/v3/init', id, body, r),
  acknowledgeSubscription: (id, body, r) => post('/subscription-requests/v3/hiu/on-notify', id, body, r),
  acknowledgeCareContextNotification: (id, body, r) => post('/subscription-requests/v3/hiu/care-context/on-notify', id, body, r)
};
