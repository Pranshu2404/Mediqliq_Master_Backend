const crypto = require('crypto');
const Hospital = require('../models/Hospital');
const { decryptSecret } = require('../utils/secretVault');
const { signRequest, stableBody } = require('../utils/internalSignature');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');

const fetchFn = (...args) => {
  if (typeof fetch === 'function') return fetch(...args);
  return import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
};

function allowedHosts() {
  return String(process.env.PLATFORM_CONNECTOR_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function loadHospitalWithSecret(hospitalId) {
  return Hospital.findById(hospitalId).select(
    '+platformConnector.secretEncrypted +platformConnector.secretEncrypted.ciphertext +platformConnector.secretEncrypted.iv +platformConnector.secretEncrypted.tag'
  );
}

async function forwardToHospital(hospitalOrId, path, body, options = {}) {
  const hospitalId = hospitalOrId?._id || hospitalOrId;
  const hospital = await loadHospitalWithSecret(hospitalId);
  if (!hospital) throw new Error('Hospital not found');
  if (!hospital.deployment?.backendUrl) throw new Error('Hospital backend URL is not configured');
  if (!['PENDING', 'ACTIVE'].includes(hospital.platformConnector?.status)) {
    throw new Error(`Platform connector is ${hospital.platformConnector?.status || 'not configured'}`);
  }
  if (!hospital.platformConnector?.keyId || !hospital.platformConnector?.secretEncrypted) {
    throw new Error('Platform connector credentials are incomplete');
  }

  const baseUrl = String(hospital.deployment.backendUrl).replace(/\/+$/, '');
  const targetUrl = await assertSafeOutboundUrl(`${baseUrl}${path}`, {
    label: 'Hospital platform connector URL',
    allowedHosts: allowedHosts(),
    requireHttps: process.env.NODE_ENV === 'production',
    allowPrivate: process.env.NODE_ENV !== 'production' && process.env.PLATFORM_ALLOW_PRIVATE_CONNECTOR_URLS === 'true'
  });

  const method = String(options.method || 'POST').toUpperCase();
  const timestamp = new Date().toISOString();
  const requestId = options.requestId || crypto.randomUUID();
  const secret = decryptSecret(hospital.platformConnector.secretEncrypted);
  const signature = signRequest(secret, {
    timestamp,
    requestId,
    method,
    path,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body
  });

  const response = await fetchFn(targetUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-MediQliq-Platform-Tenant': hospital.tenantCode,
      'X-MediQliq-Platform-Key-ID': hospital.platformConnector.keyId,
      'X-MediQliq-Platform-Timestamp': timestamp,
      'X-MediQliq-Platform-Request-ID': requestId,
      'X-MediQliq-Platform-Signature': signature
    },
    body: ['GET', 'HEAD'].includes(method) ? undefined : stableBody(body),
    redirect: 'error',
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.PLATFORM_CONNECTOR_TIMEOUT_MS || 15000))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Hospital platform connector failed: ${response.status}`);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  if (hospital.platformConnector.status === 'PENDING') {
    hospital.platformConnector.status = 'ACTIVE';
    hospital.platformConnector.lastHealthCheckAt = new Date();
    hospital.platformConnector.lastHealthCheckStatus = 'OK';
    hospital.platformConnector.lastHealthCheckError = undefined;
    await hospital.save().catch(() => {});
  }

  return data;
}

module.exports = { forwardToHospital, loadHospitalWithSecret };
