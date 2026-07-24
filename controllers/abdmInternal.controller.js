const crypto = require('crypto');
const config = require('../config/abdm.config');
const { readiness } = require('../utils/abdmOnboarding');
const { abhaRequest } = require('../services/abdmHttp.service');
const hip = require('../services/abdmHip.service');
const hiu = require('../services/abdmHiu.service');
const AbdmTransaction = require('../models/AbdmTransaction');
const AbdmConsent = require('../models/AbdmConsent');
const AbdmHiuRequest = require('../models/AbdmHiuRequest');
const AbdmDataRelayToken = require('../models/AbdmDataRelayToken');

const ABHA_ALLOWLIST = new Set([
  'GET /v3/profile/public/certificate',
  'POST /v3/enrollment/request/otp',
  'POST /v3/enrollment/enrol/byAadhaar',
  'POST /v3/enrollment/auth/byAbdm',
  'POST /v3/profile/account/abha/search',
  'POST /v3/profile/login/request/otp',
  'POST /v3/profile/login/verify',
  'GET /v3/profile/account/qrCode',
  'GET /v3/profile/account/abha-card',
  'POST /v3/profile/account/abha-address',
  'POST /v3/profile/account/abha-address/suggestion',
  'POST /v3/profile/account/abha-address/validate',
  'POST /v3/profile/account/verify',
  'POST /v3/profile/account/request/otp',
  'POST /v3/profile/account/update',
  'POST /v3/profile/account/mobile/update',
  'POST /v3/profile/account/email/update'
]);

function facilityIdentity(req, role = 'hip') {
  const facility = req.abdmFacility;
  if (role === 'hiu') {
    return facility.abdm?.hiuId || facility.abdm?.hipId || facility.facilityId;
  }
  return facility.abdm?.hipId || facility.facilityId;
}

async function createTransaction(
  facilityId,
  flow,
  requestId,
  action,
  correlation = {}
) {
  return AbdmTransaction.create({
    requestId,
    facilityId,
    flow,
    direction: 'OUTBOUND',
    status: 'WAITING_CALLBACK',
    correlation: {
      action,
      internalRequestId: correlation.internalRequestId,
      ...correlation
    },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
}

exports.health = (req, res) => {
  return res.json({
    success: true,
    role: config.appRole,
    environment: config.environment,
    facilityId: facilityIdentity(req),
    hfrFacilityId: req.abdmFacility.hfr?.facilityId,
    tenantCode: req.abdmFacility.tenantCode,
    timestamp: new Date().toISOString()
  });
};

exports.facilityStatus = (req, res) => {
  return res.json({
    success: true,
    facility: {
      hfr: req.abdmFacility.hfr,
      abdm: req.abdmFacility.abdm,
      services: req.abdmFacility.services,
      onboardingStatus: req.abdmFacility.onboardingStatus,
      connector: {
        status: req.abdmFacility.connector?.status
      },
      readiness: readiness(req.abdmFacility)
    }
  });
};

exports.proxyAbha = async (req, res) => {
  try {
    if (!config.featureM1) {
      return res.status(409).json({ error: 'M1 is disabled' });
    }

    const {
      method = 'GET',
      path,
      body,
      headers = {},
      responseType = 'json'
    } = req.body || {};

    const normalizedMethod = String(method).toUpperCase();
    const normalizedPath = String(path || '').split('?')[0];
    const operation = `${normalizedMethod} ${normalizedPath}`;

    if (!ABHA_ALLOWLIST.has(operation)) {
      return res.status(400).json({
        error: 'ABHA operation is not allow-listed by the master'
      });
    }

    const safeHeaders = {};
    for (const name of ['X-token', 'x-token', 'X-AUTH-TOKEN', 'x-auth-token']) {
      if (headers[name]) safeHeaders[name] = headers[name];
    }

    const data = await abhaRequest(path, {
      method: normalizedMethod,
      body,
      headers: safeHeaders,
      responseType
    });

    if (responseType === 'buffer') {
      return res.json({
        success: true,
        dataBase64: data.buffer.toString('base64'),
        contentType: data.contentType
      });
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
};

exports.hipAction = async (req, res) => {
  try {
    if (!config.featureM2) {
      return res.status(409).json({ error: 'M2 is disabled' });
    }

    const facilityId = facilityIdentity(req);
    const { action, body, linkToken } = req.body || {};
    const requestId = crypto.randomUUID();

    const actions = {
      GENERATE_LINK_TOKEN: {
        flow: 'HIP_LINK_TOKEN',
        execute: () => hip.generateLinkToken(facilityId, body, requestId)
      },
      LINK_CARE_CONTEXT: {
        flow: 'HIP_CARE_CONTEXT_LINK',
        execute: () => hip.linkCareContext(facilityId, linkToken, body, requestId)
      },
      NOTIFY_CARE_CONTEXT_UPDATE: {
        flow: 'CARE_CONTEXT_UPDATE',
        execute: () => hip.notifyCareContextUpdate(facilityId, body, requestId)
      },
      RESPOND_DISCOVERY: {
        flow: 'USER_DISCOVERY',
        execute: () => hip.respondDiscovery(facilityId, body, requestId)
      },
      RESPOND_LINK_INIT: {
        flow: 'USER_LINK_INIT',
        execute: () => hip.respondLinkInit(facilityId, body, requestId)
      },
      RESPOND_LINK_CONFIRM: {
        flow: 'USER_LINK_CONFIRM',
        execute: () => hip.respondLinkConfirm(facilityId, body, requestId)
      },
      ACK_CONSENT: {
        flow: 'CONSENT_NOTIFY',
        execute: () => hip.acknowledgeConsent(facilityId, body, requestId)
      },
      ACK_HEALTH_INFORMATION: {
        flow: 'HEALTH_INFORMATION_REQUEST',
        execute: () =>
          hip.acknowledgeHealthInformationRequest(facilityId, body, requestId)
      },
      NOTIFY_HEALTH_INFORMATION: {
        flow: 'HEALTH_INFORMATION_PUSH',
        execute: () => hip.notifyHealthInformation(facilityId, body, requestId)
      },
      ACK_PROFILE_SHARE: {
        flow: 'PROFILE_SHARE',
        execute: () => hip.acknowledgeProfileShare(facilityId, body, requestId)
      }
    };

    const selected = actions[action];
    if (!selected) {
      return res.status(400).json({
        error: `Unsupported HIP action: ${action}`
      });
    }

    if (action === 'LINK_CARE_CONTEXT' && !linkToken) {
      return res.status(400).json({ error: 'linkToken is required' });
    }

    const result = await selected.execute();
    await createTransaction(
      facilityId,
      selected.flow,
      requestId,
      action,
      { internalRequestId: req.abdmInternalRequestId }
    );

    return res.status(202).json({
      success: true,
      requestId,
      data: result.data
    });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
};

exports.hiuAction = async (req, res) => {
  try {
    if (!config.featureM3) {
      return res.status(409).json({ error: 'M3 is disabled' });
    }
    if (!req.abdmFacility.services?.hiu) {
      return res.status(403).json({
        error: 'HIU service is not enabled for this facility'
      });
    }

    const hiuId = facilityIdentity(req, 'hiu');
    const { action, body } = req.body || {};
    const requestId = crypto.randomUUID();

    const actions = {
      INIT_CONSENT_REQUEST: {
        flow: 'M3_CONSENT',
        execute: () => hiu.initiateConsent(hiuId, body, requestId)
      },
      GET_CONSENT_STATUS: {
        flow: 'M3_CONSENT_STATUS',
        execute: () => hiu.consentStatus(hiuId, body, requestId)
      },
      FETCH_CONSENT: {
        flow: 'M3_CONSENT_FETCH',
        execute: () => hiu.fetchConsent(hiuId, body, requestId)
      },
      ACK_CONSENT_NOTIFY: {
        flow: 'M3_CONSENT',
        execute: () => hiu.acknowledgeConsentNotify(hiuId, body, requestId)
      },
      REQUEST_HEALTH_INFORMATION: {
        flow: 'M3_HEALTH_INFORMATION_REQUEST',
        execute: () => hiu.requestHealthInformation(hiuId, body, requestId)
      },
      NOTIFY_HEALTH_INFORMATION: {
        flow: 'M3_HEALTH_INFORMATION_RECEIVE',
        execute: () => hiu.notifyHealthInformation(hiuId, body, requestId)
      },
      INIT_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.initiateSubscription(hiuId, body, requestId)
      },
      ACK_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.acknowledgeSubscription(hiuId, body, requestId)
      },
      ACK_SUBSCRIPTION_CARE_CONTEXT: {
        flow: 'M3_SUBSCRIPTION',
        execute: () =>
          hiu.acknowledgeCareContextNotification(hiuId, body, requestId)
      }
    };

    if (
      String(action).includes('SUBSCRIPTION') &&
      !config.featureSubscriptions
    ) {
      return res.status(409).json({ error: 'Subscriptions are disabled' });
    }

    const selected = actions[action];
    if (!selected) {
      return res.status(400).json({
        error: `Unsupported HIU action: ${action}`
      });
    }

    const result = await selected.execute();
    await createTransaction(
      hiuId,
      selected.flow,
      requestId,
      action,
      {
        internalRequestId: req.abdmInternalRequestId,
        consentId: body?.consent?.id || body?.consentId
      }
    );

    if (action === 'INIT_CONSENT_REQUEST') {
      const consentRequestId = body?.request?.id || requestId;
      await AbdmConsent.findOneAndUpdate(
        { facilityId: hiuId, consentRequestId },
        {
          facilityId: hiuId,
          consentRequestId,
          consentId: body?.consentId || `pending:${requestId}`,
          role: 'HIU',
          status: 'REQUESTED',
          abhaAddress: body?.patient?.id,
          hiTypes: body?.hiTypes || body?.permission?.hiTypes,
          purpose: body?.purpose,
          permission: body?.permission
        },
        { upsert: true, new: true }
      );
    }

    if (action === 'REQUEST_HEALTH_INFORMATION') {
      await AbdmHiuRequest.create({
        facilityId: hiuId,
        requestId,
        consentId: body?.hiRequest?.consent?.id || body?.consentId,
        status: 'INITIATED',
        hiTypes: body?.hiTypes,
        correlation: {
          internalRequestId: req.abdmInternalRequestId
        }
      });
    }

    return res.status(202).json({
      success: true,
      requestId,
      data: result.data
    });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
};

exports.createDataRelayToken = async (req, res) => {
  try {
    if (!config.featureM3) {
      return res.status(409).json({ error: 'M3 is disabled' });
    }
    if (!config.publicBaseUrl) {
      return res.status(503).json({
        error: 'ABDM_PUBLIC_BASE_URL is not configured'
      });
    }
    if (!req.abdmFacility.services?.hiu) {
      return res.status(403).json({
        error: 'HIU service is not enabled for this facility'
      });
    }

    const facilityId = facilityIdentity(req, 'hiu');
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const ttlSeconds = Math.max(
      300,
      Math.min(86400, Number(req.body?.ttlSeconds || 3600))
    );

    const record = await AbdmDataRelayToken.create({
      tokenHash,
      facilityId,
      consentId: req.body?.consentId,
      requestReference: req.body?.requestReference,
      maxPushes: Math.max(
        1,
        Math.min(1000, Number(req.body?.maxPushes || 20))
      ),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    });

    return res.status(201).json({
      success: true,
      relayId: record._id,
      dataPushUrl:
        `${config.publicBaseUrl}/api/v3/hiu/health-information/data/${rawToken}`,
      expiresAt: record.expiresAt
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
};
