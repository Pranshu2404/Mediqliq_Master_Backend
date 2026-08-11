const crypto = require('crypto');
const config = require('../config/abdm.config');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const AbdmConsentUsageReservation = require('../models/AbdmConsentUsageReservation');

const fetchFn = (...args) => {
  if (typeof fetch === 'function') return fetch(...args);
  return import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
};

function facilityIdentity(facility) {
  return facility?.abdm?.hipId || facility?.abdm?.hiuId || facility?.facilityId || facility?.tenantCode;
}

function stripUntrustedTenantSelectors(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const safe = { ...payload };
  delete safe.tenantCode;
  delete safe.facilityId;
  delete safe.hfrFacilityId;
  delete safe.tenantContext;
  return safe;
}

function tenantHeaders(facility, requestId, token) {
  const headers = {
    'Content-Type': 'application/json',
    'X-MediQliq-Service-Identity': 'ABDM_MASTER',
    'X-MediQliq-Request-ID': requestId || crypto.randomUUID()
  };
  if (facility?.tenantCode) headers['X-MediQliq-Tenant-Code'] = facility.tenantCode;
  if (facilityIdentity(facility)) headers['X-MediQliq-Facility-ID'] = facilityIdentity(facility);
  if (facility?.hfr?.facilityId) headers['X-MediQliq-HFR-ID'] = facility.hfr.facilityId;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function assertConfigured(rawUrl, label) {
  if (!rawUrl) {
    const error = new Error(`${label} is not configured on the MediQliq Master`);
    error.statusCode = 503;
    error.code = 'ABDM_SHARED_SERVICE_NOT_CONFIGURED';
    throw error;
  }
}

async function safePrivateUrl(rawUrl, { label, allowedHosts }) {
  assertConfigured(rawUrl, label);
  if (config.isProduction && (!Array.isArray(allowedHosts) || allowedHosts.length === 0)) {
    const error = new Error(`${label} requires an explicit host allow-list in production`);
    error.statusCode = 503;
    error.code = 'ABDM_SHARED_SERVICE_ALLOWLIST_REQUIRED';
    throw error;
  }
  return assertSafeOutboundUrl(rawUrl, {
    label,
    allowedHosts,
    requireHttps: config.sharedServicesRequireHttps,
    // Private VPC/service-network addresses are expected here. Host allow-listing
    // remains mandatory in production so arbitrary SSRF targets are not accepted.
    allowPrivate: true
  });
}

async function readJsonLimited(response, maxBytes, label) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    const error = new Error(`${label} response exceeded the configured size limit`);
    error.statusCode = 502;
    error.code = 'ABDM_SHARED_SERVICE_RESPONSE_TOO_LARGE';
    throw error;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    const error = new Error(`${label} returned invalid JSON`);
    error.statusCode = 502;
    error.code = 'ABDM_SHARED_SERVICE_INVALID_JSON';
    throw error;
  }
}

async function requestPrivateJson({
  url,
  label,
  allowedHosts,
  token,
  facility,
  requestId,
  method = 'POST',
  body,
  timeoutMs,
  maxResponseBytes
}) {
  const safeUrl = await safePrivateUrl(url, { label, allowedHosts });
  let response;
  try {
    response = await fetchFn(safeUrl, {
      method,
      headers: tenantHeaders(facility, requestId, token),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
  } catch (error) {
    const wrapped = new Error(`${label} is unavailable`);
    wrapped.statusCode = 503;
    wrapped.code = error?.name === 'TimeoutError' ? 'ABDM_SHARED_SERVICE_TIMEOUT' : 'ABDM_SHARED_SERVICE_UNREACHABLE';
    throw wrapped;
  }

  const data = await readJsonLimited(response, maxResponseBytes, label);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `${label} failed with HTTP ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    error.code = data?.code || 'ABDM_SHARED_SERVICE_REJECTED';
    // Only return structured validator/service errors. Never attach the submitted payload.
    error.details = {
      code: data?.code,
      valid: data?.valid,
      decision: data?.decision,
      reasonCodes: Array.isArray(data?.reasonCodes) ? data.reasonCodes.slice(0, 100) : undefined,
      errors: Array.isArray(data?.errors) ? data.errors.slice(0, 100) : undefined,
      warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 100) : undefined
    };
    throw error;
  }
  return data;
}

function cryptoUrl(path) {
  const base = String(config.sharedCryptoAdapterUrl || '').replace(/\/+$/, '');
  return base ? new URL(path.replace(/^\//, ''), `${base}/`).toString() : '';
}

function consentUrl(path = '') {
  if (!config.sharedConsentValidatorUrl) return '';
  const configured = new URL(config.sharedConsentValidatorUrl);
  if (!path) return configured.toString();
  return new URL(path, `${configured.origin}/`).toString();
}

async function validateFhir(facility, payload, requestId) {
  return requestPrivateJson({
    url: config.sharedFhirValidatorUrl,
    label: 'Shared FHIR validator',
    allowedHosts: config.sharedFhirValidatorAllowedHosts,
    token: config.sharedFhirValidatorToken,
    facility,
    requestId,
    body: stripUntrustedTenantSelectors(payload),
    timeoutMs: config.sharedFhirValidatorTimeoutMs,
    maxResponseBytes: config.sharedFhirValidatorMaxResponseBytes
  });
}

async function generateReceiverKeyMaterial(facility, payload, requestId) {
  const result = await requestPrivateJson({
    url: cryptoUrl('/v1/receiver-key-material'),
    label: 'Shared crypto adapter',
    allowedHosts: config.sharedCryptoAdapterAllowedHosts,
    token: config.sharedCryptoAdapterToken,
    facility,
    requestId,
    body: stripUntrustedTenantSelectors(payload),
    timeoutMs: config.sharedCryptoAdapterTimeoutMs,
    maxResponseBytes: config.sharedCryptoAdapterMaxResponseBytes
  });
  if (!result.publicKeyMaterial || (!result.keyHandle && !result.privateMaterial)) {
    const error = new Error('Shared crypto adapter returned incomplete receiver key material');
    error.statusCode = 502;
    error.code = 'ABDM_CRYPTO_KEY_MATERIAL_INVALID';
    throw error;
  }
  if (config.isProduction && !result.keyHandle) {
    const error = new Error('Production shared crypto adapter must return an opaque keyHandle');
    error.statusCode = 502;
    error.code = 'ABDM_CRYPTO_KEY_HANDLE_REQUIRED';
    throw error;
  }
  return result;
}

async function encryptHealthInformation(facility, payload, requestId) {
  const result = await requestPrivateJson({
    url: cryptoUrl('/v1/encrypt'),
    label: 'Shared crypto adapter',
    allowedHosts: config.sharedCryptoAdapterAllowedHosts,
    token: config.sharedCryptoAdapterToken,
    facility,
    requestId,
    body: stripUntrustedTenantSelectors(payload),
    timeoutMs: config.sharedCryptoAdapterTimeoutMs,
    maxResponseBytes: config.sharedCryptoAdapterMaxResponseBytes
  });
  if (!Array.isArray(result.entries) || !result.entries.length || !result.keyMaterial) {
    const error = new Error('Shared crypto adapter returned an invalid encrypted package');
    error.statusCode = 502;
    error.code = 'ABDM_CRYPTO_ENCRYPT_RESPONSE_INVALID';
    throw error;
  }
  return result;
}

async function decryptHealthInformation(facility, payload, requestId) {
  if (config.isProduction && payload?.privateMaterial) {
    const error = new Error('Production shared crypto accepts only opaque keyHandle receiver material');
    error.statusCode = 422;
    error.code = 'ABDM_CRYPTO_PRIVATE_MATERIAL_FORBIDDEN';
    throw error;
  }
  if (config.isProduction && !payload?.keyHandle) {
    const error = new Error('Production shared crypto requires an opaque keyHandle');
    error.statusCode = 422;
    error.code = 'ABDM_CRYPTO_KEY_HANDLE_REQUIRED';
    throw error;
  }
  const result = await requestPrivateJson({
    url: cryptoUrl('/v1/decrypt'),
    label: 'Shared crypto adapter',
    allowedHosts: config.sharedCryptoAdapterAllowedHosts,
    token: config.sharedCryptoAdapterToken,
    facility,
    requestId,
    body: stripUntrustedTenantSelectors(payload),
    timeoutMs: config.sharedCryptoAdapterTimeoutMs,
    maxResponseBytes: config.sharedCryptoAdapterMaxResponseBytes
  });
  if (!Array.isArray(result.records)) {
    const error = new Error('Shared crypto adapter returned no decrypted records');
    error.statusCode = 502;
    error.code = 'ABDM_CRYPTO_DECRYPT_RESPONSE_INVALID';
    throw error;
  }
  if (config.requireSharedCryptoIntegrity && result.integrityVerified !== true) {
    const error = new Error('Shared crypto adapter did not confirm authenticated decryption integrity');
    error.statusCode = 422;
    error.code = 'ABDM_CRYPTO_INTEGRITY_UNVERIFIED';
    throw error;
  }
  return result;
}

function reservationHash(reservationId) {
  return crypto.createHash('sha256').update(String(reservationId)).digest('hex');
}

function reservationExpiry(result) {
  const candidate = result?.usage?.expiresAt || result?.decisionExpiresAt || result?.retentionUntil;
  const parsed = candidate ? new Date(candidate) : null;
  if (parsed && Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  return new Date(Date.now() + config.sharedConsentReservationTtlSeconds * 1000);
}

async function rememberConsentReservation(facility, result) {
  const reservationId = result?.usage?.reservationId;
  if (!reservationId) return result;
  await AbdmConsentUsageReservation.findOneAndUpdate(
    { reservationHash: reservationHash(reservationId) },
    {
      $setOnInsert: {
        tenantCode: facility.tenantCode,
        facilityId: facilityIdentity(facility),
        hospital: facility.hospital,
        validationId: result.validationId,
        status: 'RESERVED',
        decisionExpiresAt: result.decisionExpiresAt ? new Date(result.decisionExpiresAt) : undefined,
        expiresAt: reservationExpiry(result)
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return result;
}

async function validateConsent(facility, payload, requestId) {
  const safePayload = stripUntrustedTenantSelectors(payload);
  const result = await requestPrivateJson({
    url: config.sharedConsentValidatorUrl,
    label: 'Shared consent validator',
    allowedHosts: config.sharedConsentValidatorAllowedHosts,
    token: config.sharedConsentValidatorToken,
    facility,
    requestId,
    body: safePayload,
    timeoutMs: config.sharedConsentValidatorTimeoutMs,
    maxResponseBytes: config.sharedConsentValidatorMaxResponseBytes
  });
  return rememberConsentReservation(facility, result);
}

async function claimReservation(facility, reservationId, action) {
  const hash = reservationHash(reservationId);
  const processing = action === 'commit' ? 'COMMITTING' : 'RELEASING';
  const now = new Date();
  const staleBefore = new Date(now.getTime() - config.sharedConsentReservationStaleLockMs);
  const row = await AbdmConsentUsageReservation.findOneAndUpdate(
    {
      reservationHash: hash,
      tenantCode: facility.tenantCode,
      facilityId: facilityIdentity(facility),
      expiresAt: { $gt: now },
      $or: [
        { status: 'RESERVED' },
        { status: processing, lastActionAt: { $lt: staleBefore } }
      ]
    },
    { $set: { status: processing, lastActionAt: now } },
    { new: true }
  );
  if (row) return { row, alreadyDone: false };

  const existing = await AbdmConsentUsageReservation.findOne({
    reservationHash: hash,
    tenantCode: facility.tenantCode,
    facilityId: facilityIdentity(facility)
  }).lean();
  const finished = action === 'commit' ? 'COMMITTED' : 'RELEASED';
  if (existing?.status === finished) return { row: existing, alreadyDone: true };

  const error = new Error(existing ? 'Consent usage reservation is not in a valid state for this action' : 'Consent usage reservation does not belong to this hospital or has expired');
  error.statusCode = existing ? 409 : 404;
  error.code = existing ? 'ABDM_CONSENT_RESERVATION_STATE_INVALID' : 'ABDM_CONSENT_RESERVATION_NOT_FOUND';
  throw error;
}

async function consentUsageAction(facility, reservationId, action, requestId) {
  if (!reservationId || !String(reservationId).trim()) {
    const error = new Error('reservationId is required');
    error.statusCode = 400;
    error.code = 'ABDM_CONSENT_RESERVATION_ID_REQUIRED';
    throw error;
  }
  if (!['commit', 'release'].includes(action)) {
    const error = new Error('Consent usage action must be commit or release');
    error.statusCode = 400;
    throw error;
  }
  const claim = await claimReservation(facility, reservationId, action);
  if (claim.alreadyDone) return { success: true, idempotent: true, status: claim.row.status };

  try {
    const result = await requestPrivateJson({
      url: consentUrl(`/v1/usage/${encodeURIComponent(reservationId)}/${action}`),
      label: `Shared consent usage ${action}`,
      allowedHosts: config.sharedConsentValidatorAllowedHosts,
      token: config.sharedConsentValidatorToken,
      facility,
      requestId,
      body: {},
      timeoutMs: config.sharedConsentValidatorTimeoutMs,
      maxResponseBytes: Math.min(config.sharedConsentValidatorMaxResponseBytes, 128 * 1024)
    });
    await AbdmConsentUsageReservation.updateOne(
      { _id: claim.row._id },
      { $set: { status: action === 'commit' ? 'COMMITTED' : 'RELEASED', lastActionAt: new Date() } }
    );
    return result;
  } catch (error) {
    await AbdmConsentUsageReservation.updateOne(
      { _id: claim.row._id },
      { $set: { status: 'RESERVED', lastActionAt: new Date() } }
    ).catch(() => {});
    throw error;
  }
}

async function recordConsentStatusEvent(facility, payload, requestId) {
  const safePayload = stripUntrustedTenantSelectors(payload);
  return requestPrivateJson({
    url: consentUrl('/v1/status-events'),
    label: 'Shared consent status event',
    allowedHosts: config.sharedConsentValidatorAllowedHosts,
    token: config.sharedConsentValidatorToken,
    facility,
    requestId,
    body: safePayload,
    timeoutMs: config.sharedConsentValidatorTimeoutMs,
    maxResponseBytes: Math.min(config.sharedConsentValidatorMaxResponseBytes, 128 * 1024)
  });
}

async function healthRequest({ facility, requestId, url, label, allowedHosts, token, timeoutMs }) {
  if (!url) return { configured: false, healthy: false, location: 'MEDIQLIQ_MASTER' };
  const startedAt = Date.now();
  try {
    const data = await requestPrivateJson({
      url,
      label,
      allowedHosts,
      token,
      facility,
      requestId,
      method: 'GET',
      body: undefined,
      timeoutMs: Math.min(timeoutMs, 5000),
      maxResponseBytes: 256 * 1024
    });
    return {
      configured: true,
      healthy: data.healthy !== false && data.ready !== false && data.status !== 'DOWN' && data.status !== 'down',
      latencyMs: Date.now() - startedAt,
      version: data.version || data.appVersion || data.validatorVersion,
      package: data.package,
      fhirVersion: data.fhirVersion,
      integrityCapable: data.integrityCapable,
      keyHandles: data.keyHandles,
      productionCapable: data.productionCapable,
      trustReady: data.trustReady,
      databaseReady: data.databaseReady,
      capabilities: data.capabilities,
      checkedAt: new Date().toISOString(),
      location: 'MEDIQLIQ_MASTER'
    };
  } catch (error) {
    return {
      configured: true,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      errorCode: error.code || 'UNAVAILABLE',
      checkedAt: new Date().toISOString(),
      location: 'MEDIQLIQ_MASTER'
    };
  }
}

async function sharedHealth(facility, requestId) {
  const fhirHealthUrl = config.sharedFhirValidatorHealthUrl || (config.sharedFhirValidatorUrl
    ? new URL('/validator/version', `${config.sharedFhirValidatorUrl.replace(/\/+$/, '')}/`).toString()
    : '');
  const cryptoHealthUrl = config.sharedCryptoAdapterHealthUrl || (config.sharedCryptoAdapterUrl
    ? new URL('/health', `${config.sharedCryptoAdapterUrl.replace(/\/+$/, '')}/`).toString()
    : '');
  const consentHealthUrl = config.sharedConsentValidatorHealthUrl || consentUrl('/health/ready');

  const [fhir, cryptoAdapter, consent] = await Promise.all([
    healthRequest({ facility, requestId, url: fhirHealthUrl, label: 'Shared FHIR validator health', allowedHosts: config.sharedFhirValidatorAllowedHosts, token: config.sharedFhirValidatorToken, timeoutMs: config.sharedFhirValidatorTimeoutMs }),
    healthRequest({ facility, requestId, url: cryptoHealthUrl, label: 'Shared crypto adapter health', allowedHosts: config.sharedCryptoAdapterAllowedHosts, token: config.sharedCryptoAdapterToken, timeoutMs: config.sharedCryptoAdapterTimeoutMs }),
    healthRequest({ facility, requestId, url: consentHealthUrl, label: 'Shared consent validator health', allowedHosts: config.sharedConsentValidatorAllowedHosts, token: config.sharedConsentValidatorToken, timeoutMs: config.sharedConsentValidatorTimeoutMs })
  ]);

  return {
    fhirValidator: fhir,
    cryptoAdapter,
    consentValidator: consent,
    productionTransferReady: Boolean(
      fhir.healthy &&
      cryptoAdapter.healthy &&
      cryptoAdapter.integrityCapable !== false &&
      consent.healthy &&
      consent.productionCapable !== false
    ),
    checkedAt: new Date().toISOString()
  };
}

async function sharedPlatformHealth(requestId) {
  return sharedHealth(null, requestId || `master-admin:${crypto.randomUUID()}`);
}

module.exports = {
  validateFhir,
  generateReceiverKeyMaterial,
  encryptHealthInformation,
  decryptHealthInformation,
  validateConsent,
  consentUsageAction,
  recordConsentStatusEvent,
  sharedHealth,
  sharedPlatformHealth,
  reservationHash,
  facilityIdentity
};
