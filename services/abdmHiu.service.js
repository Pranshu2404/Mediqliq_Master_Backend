const crypto = require('crypto');
const config = require('../config/abdm.config');
const { hiecmRequest } = require('./abdmHttp.service');

function headers(hiuId, extra = {}) {
  return { 'X-HIU-ID': hiuId, 'X-CM-ID': config.cmId, ...extra };
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
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

function get(path, hiuId, requestId, options = {}) {
  return request(path, hiuId, { method: 'GET', requestId, ...options });
}

module.exports = {
  initiateConsent: (id, body, r) => post('/consent/v3/request/init', id, body, r),
  consentStatus: (id, body, r) => post('/consent/v3/request/status', id, body, r),
  fetchConsent: (id, body, r) => post('/consent/v3/fetch', id, body, r),
  acknowledgeConsentNotify: (id, body, r) => post('/consent/v3/request/hiu/on-notify', id, body, r),

  // PHR/Patient consent lifecycle APIs from the V3 PHR specification.
  listConsentRequests: (id, query, r, authToken) => get(`/consent/v3/request${queryString(query)}`, id, r, { authToken }),
  getConsentRequest: (id, value, r, authToken) => get(`/consent/v3/request/${encodeURIComponent(value)}`, id, r, { authToken }),
  consentArtefactsByRequest: (id, value, r, authToken) => get(`/consent/v3/artefact/request/${encodeURIComponent(value)}`, id, r, { authToken }),
  getConsentArtefact: (id, value, r, authToken) => get(`/consent/v3/artefact/${encodeURIComponent(value)}`, id, r, { authToken }),
  listConsentArtefacts: (id, query, r, authToken) => get(`/consent/v3/artefact${queryString(query)}`, id, r, { authToken }),
  createConsentAutoApprove: (id, body, r, authToken) => post('/consent/v3/auto/approve', id, body, r, { authToken }),
  disableConsentAutoApprove: (id, value, r, authToken) => post(`/consent/v3/auto/approve/${encodeURIComponent(value)}/disable`, id, undefined, r, { authToken }),
  enableConsentAutoApprove: (id, value, r, authToken) => post(`/consent/v3/auto/approve/${encodeURIComponent(value)}/enable`, id, undefined, r, { authToken }),
  denyConsentRequest: (id, value, body, r, authToken) => post(`/consent/v3/request/${encodeURIComponent(value)}/deny`, id, body, r, { authToken }),
  revokeConsent: (id, body, r, authToken) => post('/consent/v3/revoke', id, body, r, { authToken }),

  requestHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/request', id, body, r),
  notifyHealthInformation: (id, body, r) => post('/data-flow/v3/health-information/notify', id, body, r),
  healthInformationStatus: (id, transactionId, r, authToken) => get(`/data-flow/v3/health-information/request/status/${encodeURIComponent(transactionId)}`, id, r, { authToken }),

  requestRunningTokenStatus: (id, body, r, authToken) => post('/patient-share/v3/running-token/status', id, body, r, { authToken }),
  listHealthLockers: (id, query, r) => get(`/gateway/v3/health-lockers${queryString(query)}`, id, r),

  // Patient/PHR user-initiated discovery + linking.
  discoverHealthRecords: (id, body, r, authToken) => post('/user-initiated-linking/v3/patient/care-context/discover', id, body, r, { authToken }),
  initHealthRecordLink: (id, body, r, authToken) => post('/user-initiated-linking/v3/link/care-context/init', id, body, r, { authToken }),
  confirmHealthRecordLink: (id, body, r, authToken) => post('/user-initiated-linking/v3/link/care-context/confirm', id, body, r, { authToken }),
  listPatientLinks: (id, query, r, authToken) => get(`/hip/v3/link/patient/links${queryString(query)}`, id, r, { authToken }),
  listProviders: (id, query, r, authToken) => get(`/gateway/v3/providers${queryString(query)}`, id, r, { authToken }),
  getProvider: (id, providerId, r, authToken) => get(`/gateway/v3/providers/${encodeURIComponent(providerId)}`, id, r, { authToken }),
  govtPrograms: (id, query, r, authToken) => get(`/gateway/v3/govt-programs${queryString(query)}`, id, r, { authToken }),

  initiateSubscription: (id, body, r) => post('/subscription-requests/v3/init', id, body, r),
  approveSubscription: (id, requestIdValue, body, r, authToken) => post(`/subscription-requests/v3/${encodeURIComponent(requestIdValue)}/approve`, id, body, r, { authToken }),
  denySubscription: (id, requestIdValue, body, r, authToken) => post(`/subscription-requests/v3/${encodeURIComponent(requestIdValue)}/deny`, id, body, r, { authToken }),
  listSubscriptionRequests: (id, query, r, authToken) => get(`/subscription-requests/v3/requests${queryString(query)}`, id, r, { authToken }),
  getSubscriptionByRequestId: (id, value, r, authToken) => get(`/subscription-requests/v3/request/${encodeURIComponent(value)}`, id, r, { authToken }),
  getSubscription: (id, value, r, authToken) => get(`/subscription-requests/v3/${encodeURIComponent(value)}`, id, r, { authToken }),
  editSubscription: (id, value, body, r, authToken) => request(`/subscription-requests/v3/patients/${encodeURIComponent(value)}`, id, { method: 'PUT', body, requestId: r, authToken }),
  disableSubscription: (id, value, r, authToken) => post(`/subscription-requests/v3/disable/${encodeURIComponent(value)}`, id, undefined, r, { authToken }),
  enableSubscription: (id, value, r, authToken) => post(`/subscription-requests/v3/enable/${encodeURIComponent(value)}`, id, undefined, r, { authToken }),
  patientRequests: (id, query, r, authToken) => get(`/subscription-requests/v3/patients/requests${queryString(query)}`, id, r, { authToken }),
  setupLocker: (id, body, r, authToken) => post('/subscription-requests/v3/setup-locker', id, body, r, { authToken }),
  patientLockers: (id, query, r, authToken) => get(`/subscription-requests/v3/patients/lockers${queryString(query)}`, id, r, { authToken }),
  patientLocker: (id, lockerId, r, authToken) => get(`/subscription-requests/v3/patients/lockers/${encodeURIComponent(lockerId)}`, id, r, { authToken, lockerId }),
  acknowledgeSubscription: (id, body, r) => post('/subscription-requests/v3/hiu/on-notify', id, body, r),
  acknowledgeCareContextNotification: (id, body, r) => post('/subscription-requests/v3/hiu/care-context/on-notify', id, body, r)
};
