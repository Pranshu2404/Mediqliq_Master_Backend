const AuditLog = require('../models/AuditLog');
const AbdmSharedRateLimitBucket = require('../models/AbdmSharedRateLimitBucket');
const config = require('../config/abdm.config');

const SERVICE_NAMES = new Set(['FHIR', 'CRYPTO', 'CONSENT', 'HEALTH']);

function facilityIdentity(facility) {
  return facility?.abdm?.hipId || facility?.abdm?.hiuId || facility?.facilityId || facility?.tenantCode;
}

function limitFor(service) {
  const specific = {
    FHIR: config.sharedFhirRateLimitPerMinute,
    CRYPTO: config.sharedCryptoRateLimitPerMinute,
    CONSENT: config.sharedConsentRateLimitPerMinute,
    HEALTH: config.sharedHealthRateLimitPerMinute
  }[service];
  return Math.max(1, Number(specific || config.sharedServiceRateLimitPerMinute || 300));
}

function minuteWindow(date = new Date()) {
  const start = new Date(date);
  start.setUTCSeconds(0, 0);
  return start;
}

async function incrementBucket({ tenantCode, facilityId, service, now = new Date() }) {
  const windowStartedAt = minuteWindow(now);
  const expiresAt = new Date(windowStartedAt.getTime() + 2 * 60 * 1000);
  const key = `${tenantCode}:${service}:${windowStartedAt.toISOString()}`;
  try {
    return await AbdmSharedRateLimitBucket.findOneAndUpdate(
      { key },
      {
        $setOnInsert: { tenantCode, facilityId, service, windowStartedAt, expiresAt },
        $inc: { count: 1 }
      },
      { upsert: true, new: true }
    ).lean();
  } catch (error) {
    // Concurrent first requests from different Master nodes can race on the
    // unique bucket key. Retry as a plain increment instead of rejecting a
    // legitimate hospital request.
    if (error?.code !== 11000) throw error;
    return AbdmSharedRateLimitBucket.findOneAndUpdate(
      { key },
      { $inc: { count: 1 } },
      { new: true }
    ).lean();
  }
}

function metadataOnlyAudit(service, req, res, startedAt) {
  const facility = req.abdmFacility;
  const tenantCode = facility?.tenantCode;
  const facilityId = facilityIdentity(facility);
  const contentLength = Number(req.headers['content-length']);
  const responseLength = Number(res.getHeader('content-length'));
  const requestId = req.abdmInternalRequestId || req.headers['x-mediqliq-request-id'];

  AuditLog.create({
    requestId: requestId || `shared:${Date.now()}`,
    hospitalId: facility?.hospital,
    request: {
      method: req.method,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      params: {},
      query: {},
      // Deliberately do not store request bodies or operational headers. These
      // shared services may transiently process clinical/FHIR payloads.
      ip: req.ip,
      userAgent: req.headers['user-agent']
    },
    response: {
      statusCode: res.statusCode,
      success: res.statusCode < 400,
      responseTimeMs: Date.now() - startedAt
    },
    metadata: {
      kind: 'ABDM_SHARED_SERVICE_CALL',
      service,
      tenantCode,
      facilityId,
      requestBytes: Number.isFinite(contentLength) ? contentLength : undefined,
      responseBytes: Number.isFinite(responseLength) ? responseLength : undefined
    }
  }).catch((error) => {
    console.error('ABDM shared-service audit write failed:', error.message);
  });
}

function sharedAbdmServiceGuard(serviceName) {
  const service = String(serviceName || '').toUpperCase();
  if (!SERVICE_NAMES.has(service)) throw new Error(`Unsupported shared ABDM service guard: ${service}`);

  return async function guard(req, res, next) {
    const startedAt = Date.now();
    let auditAttached = false;
    const attachAudit = () => {
      if (auditAttached) return;
      auditAttached = true;
      res.on('finish', () => metadataOnlyAudit(service, req, res, startedAt));
    };

    try {
      attachAudit();
      const facility = req.abdmFacility;
      if (!facility?.tenantCode) {
        return res.status(403).json({ success: false, error: 'Authenticated facility tenant context is unavailable' });
      }
      const facilityId = facilityIdentity(facility);
      const bucket = await incrementBucket({
        tenantCode: facility.tenantCode,
        facilityId,
        service
      });
      const max = limitFor(service);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - Number(bucket.count || 0))));
      if (Number(bucket.count || 0) > max) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ success: false, error: 'Shared ABDM service rate limit exceeded for this hospital' });
      }
      req.abdmSharedService = service;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { sharedAbdmServiceGuard, incrementBucket, facilityIdentity };
