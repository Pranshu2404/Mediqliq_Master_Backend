const abdmConfig = require('../config/abdm.config');
const { getGatewayToken, clearGatewayTokenCache } = require('./abdmAuth.service');
const { gatewayHeaders } = require('../utils/abdmRequest');

const fetchFn = (...args) => {
  if (typeof fetch === 'function') return fetch(...args);
  return import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
};

function makeError(prefix, response, data) {
  const error = new Error(
    data?.message || data?.error?.message || data?.error || `${prefix}: ${response.status}`
  );
  error.statusCode = response.status;
  error.details = data;
  return error;
}

async function parseResponse(response, responseType = 'json') {
  if (responseType === 'buffer') {
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      status: response.status
    };
  }
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

async function authorizedRequest(url, options = {}, retry = true) {
  const token = await getGatewayToken();
  const headers = gatewayHeaders(token, options.headers || {}, {
    requestId: options.requestId,
    timestamp: options.timestamp
  });

  const response = await fetchFn(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (response.status === 401 && retry) {
    clearGatewayTokenCache();
    return authorizedRequest(url, options, false);
  }

  // ABDM M1 and PHR contracts used by the hospital return their patient
  // token material in the documented response body. Keep this HTTP service
  // transport-neutral instead of promoting response headers into token semantics.
  const data = await parseResponse(response, options.responseType || 'json');
  if (!response.ok) {
    throw makeError(options.errorPrefix || 'ABDM API failed', response, data);
  }
  return data;
}

function abhaRequest(path, options = {}) {
  return authorizedRequest(`${abdmConfig.abhaBaseUrl}${path}`, {
    ...options,
    errorPrefix: options.errorPrefix || 'ABHA API failed'
  });
}

function hiecmRequest(path, options = {}) {
  return authorizedRequest(`${abdmConfig.hiecmBaseUrl}${path}`, {
    ...options,
    errorPrefix: options.errorPrefix || 'ABDM HIE-CM API failed'
  });
}

async function updateBridgeUrl(bridgeUrl) {
  if (!bridgeUrl || !/^https:\/\//i.test(bridgeUrl)) {
    throw new Error('ABDM bridge URL must be a public HTTPS URL');
  }
  return hiecmRequest('/gateway/v3/bridge/url', {
    method: 'PATCH',
    body: { url: bridgeUrl }
  });
}

async function getBridgeServices() {
  return hiecmRequest('/gateway/v3/bridge-services', { method: 'GET' });
}

async function getBridgeByServiceId(serviceId) {
  return hiecmRequest(`/gateway/v3/bridge-service/serviceId/${encodeURIComponent(serviceId)}`, { method: 'GET' });
}


async function registerBridgeServices(body) {
  const registrationToken =
    abdmConfig.facilityRegistrationToken || (await getGatewayToken());
  const url = new URL(abdmConfig.facilityRegistrationUrl);
  const allowedHosts = new Set(abdmConfig.facilityRegistrationAllowedHosts || []);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new Error(
      `ABDM_FACILITY_REGISTRATION_URL must use HTTPS and an approved host: ${Array.from(allowedHosts).join(', ')}`
    );
  }
  const response = await fetchFn(url.toString(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registrationToken}`
    },
    body: JSON.stringify(body),
    redirect: 'error'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw makeError('ABDM bridge-service registration failed', response, data);
  return data;
}

module.exports = {
  authorizedRequest,
  abhaRequest,
  hiecmRequest,
  updateBridgeUrl,
  getBridgeServices,
  getBridgeByServiceId,
  registerBridgeServices
};
