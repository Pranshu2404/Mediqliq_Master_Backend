const crypto = require('crypto');
const config = require('../config/abdm.config');
const { hiecmRequest } = require('./abdmHttp.service');

function headers(hiuId, extra = {}) {
  return { 'X-HIU-ID': hiuId, 'X-CM-ID': config.cmId, ...extra };
}

function request(path, hiuId, { method = 'POST', body, requestId = crypto.randomUUID(), authToken, lockerId } = {}) {
  const extra = {};
  if (authToken) {
    // ABDM HIE-CM expects X-AUTH-TOKEN as the raw patient JWT.
    // The Bearer scheme is used only by the gateway Authorization header.
    extra['X-AUTH-TOKEN'] = String(authToken)
      .replace(/^Bearer\s+/i, '')
      .trim();
  }
  if (lockerId) extra['X-LOCKER-ID'] = lockerId;
  return hiecmRequest(path, {
    method,
    body,
    headers: headers(hiuId, extra),
    requestId
  }).then((data) => ({ requestId, data }));
}

function post(path, hiuId, body, requestId, options = {}) {
  return request(path, hiuId, { method: 'POST', body, requestId, ...options });
}

module.exports = {
  initiateConsent: (id, body, r) => post('/consent/v3/request/init', id, body, r),
  consentStatus: (id, body, r) => post('/consent/v3/request/status', id, body, r),
  fetchConsent: (id, body, r) => post('/consent/v3/fetch', id, body, r),
  acknowledgeConsentNotify: (id, body, r) => post('/consent/v3/request/hiu/on-notify', id, body, r),
  requestHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/request', id, body, r),
  notifyHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/notify', id, body, r),
  requestRunningTokenStatus: (id, body, r, authToken) => post('/patient-share/v3/running-token/status', id, body, r, { authToken }),
  listHealthLockers: (id, query, r) => request(`/gateway/v3/health-lockers?${new URLSearchParams(query || {}).toString()}`, id, { method: 'GET', requestId: r }),

  initiateSubscription: (id, body, r) => post('/subscription-requests/v3/init', id, body, r),
  approveSubscription: (id, requestIdValue, body, r, authToken) => post(`/subscription-requests/v3/${encodeURIComponent(requestIdValue)}/approve`, id, body, r, { authToken }),
  denySubscription: (id, requestIdValue, body, r, authToken) => post(`/subscription-requests/v3/${encodeURIComponent(requestIdValue)}/deny`, id, body, r, { authToken }),
  listSubscriptionRequests: (id, query, r, authToken) => request(`/subscription-requests/v3/requests?${new URLSearchParams(query || {}).toString()}`, id, { method: 'GET', requestId: r, authToken }),
  getSubscriptionByRequestId: (id, value, r, authToken) => request(`/subscription-requests/v3/request/${encodeURIComponent(value)}`, id, { method: 'GET', requestId: r, authToken }),
  getSubscription: (id, value, r, authToken) => request(`/subscription-requests/v3/${encodeURIComponent(value)}`, id, { method: 'GET', requestId: r, authToken }),
  editSubscription: (id, value, body, r, authToken) => request(`/subscription-requests/v3/patients/${encodeURIComponent(value)}`, id, { method: 'PUT', body, requestId: r, authToken }),
  disableSubscription: (id, value, r, authToken) => post(`/subscription-requests/v3/disable/${encodeURIComponent(value)}`, id, undefined, r, { authToken }),
  enableSubscription: (id, value, r, authToken) => post(`/subscription-requests/v3/enable/${encodeURIComponent(value)}`, id, undefined, r, { authToken }),
  patientRequests: (id, query, r, authToken) => request(`/subscription-requests/v3/patients/requests?${new URLSearchParams(query || {}).toString()}`, id, { method: 'GET', requestId: r, authToken }),
  setupLocker: (id, body, r, authToken) => post('/subscription-requests/v3/setup-locker', id, body, r, { authToken }),
  patientLockers: (id, query, r, authToken) => request(`/subscription-requests/v3/patients/lockers?${new URLSearchParams(query || {}).toString()}`, id, { method: 'GET', requestId: r, authToken }),
  patientLocker: (id, lockerId, r, authToken) => request(`/subscription-requests/v3/patients/lockers/${encodeURIComponent(lockerId)}`, id, { method: 'GET', requestId: r, authToken, lockerId }),
  acknowledgeSubscription: (id, body, r) => post('/subscription-requests/v3/hiu/on-notify', id, body, r),
  acknowledgeCareContextNotification: (id, body, r) => post('/subscription-requests/v3/hiu/care-context/on-notify', id, body, r)
};
