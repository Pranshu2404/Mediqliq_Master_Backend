const Hospital = require('../models/Hospital');
const PlatformRequest = require('../models/PlatformRequest');
const { decryptSecret } = require('../utils/secretVault');
const { signRequest, safeEqual } = require('../utils/internalSignature');

function requestHeaders(req) {
  return {
    tenantCode: req.headers['x-mediqliq-platform-tenant'],
    keyId: req.headers['x-mediqliq-platform-key-id'],
    timestamp: req.headers['x-mediqliq-platform-timestamp'],
    requestId: req.headers['x-mediqliq-platform-request-id'],
    signature: req.headers['x-mediqliq-platform-signature']
  };
}

function validAge(timestamp) {
  const value = new Date(timestamp).getTime();
  const maxAge = Number(process.env.PLATFORM_INTERNAL_REQUEST_MAX_AGE_MS || 5 * 60 * 1000);
  return Number.isFinite(value) && Math.abs(Date.now() - value) <= maxAge;
}

async function consumeRequestId(requestId, tenantCode) {
  try {
    await PlatformRequest.create({
      requestId,
      direction: 'MASTER_INBOUND',
      identity: tenantCode,
      expiresAt: new Date(Date.now() + Number(process.env.PLATFORM_INTERNAL_REPLAY_TTL_SECONDS || 600) * 1000)
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

async function verifyPlatformInbound(req, res, next) {
  try {
    const h = requestHeaders(req);
    if (!h.tenantCode || !h.keyId || !h.timestamp || !h.requestId || !h.signature) {
      return res.status(401).json({ success: false, error: 'Missing MediQliq platform signature headers' });
    }
    if (!validAge(h.timestamp)) {
      return res.status(401).json({ success: false, error: 'Platform request timestamp is expired or invalid' });
    }

    const hospital = await Hospital.findOne({ tenantCode: String(h.tenantCode).trim().toUpperCase() })
      .select('+platformConnector.secretEncrypted +platformConnector.secretEncrypted.ciphertext +platformConnector.secretEncrypted.iv +platformConnector.secretEncrypted.tag');

    if (!hospital || !['PENDING', 'ACTIVE'].includes(hospital.platformConnector?.status) || hospital.platformConnector?.keyId !== h.keyId) {
      return res.status(401).json({ success: false, error: 'Unknown or inactive platform connector' });
    }

    const body = ['GET', 'HEAD'].includes(String(req.method).toUpperCase()) ? undefined : req.body;
    const secret = decryptSecret(hospital.platformConnector.secretEncrypted);
    const expected = signRequest(secret, {
      timestamp: h.timestamp,
      requestId: h.requestId,
      method: req.method,
      path: req.originalUrl,
      body
    });
    if (!safeEqual(expected, h.signature)) {
      return res.status(401).json({ success: false, error: 'Invalid platform connector signature' });
    }
    if (!(await consumeRequestId(h.requestId, hospital.tenantCode))) {
      return res.status(409).json({ success: false, error: 'Duplicate platform request rejected' });
    }

    if (hospital.platformConnector.status === 'PENDING') {
      hospital.platformConnector.status = 'ACTIVE';
      await hospital.save().catch(() => {});
    }
    req.platformHospital = hospital;
    req.platformRequestId = h.requestId;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { verifyPlatformInbound };
