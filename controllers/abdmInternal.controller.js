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
const { sanitizeDependencyReport } = require('../utils/abdmDependencyStatus');
const {
  PHR_APP_ABHA_OPERATIONS
} = require('../config/abdmPhrCapabilities');

const ABHA_ALLOWLIST = new Set([
  'GET /v3/profile/public/certificate',
  'POST /v3/enrollment/request/otp',
  'POST /v3/enrollment/enrol/byAadhaar',
  'POST /v3/enrollment/enrol/byDocument',
  'POST /v3/enrollment/enrol/auth/init',
  'POST /v3/enrollment/enrol/capturePID',
  'POST /v3/enrollment/auth/byAbdm',
  'GET /v3/enrollment/enrol/suggestion',
  'POST /v3/enrollment/enrol/abha-address',
  'POST /v3/profile/account/abha/search',
  'POST /v3/profile/login/search',
  'POST /v3/profile/login/request/otp',
  'POST /v3/login/request/otp',
  'POST /v3/profile/login/verify',
  'POST /v3/profile/login/verify/user',
  'GET /v3/profile/account',
  'PATCH /v3/profile/account',
  'GET /v3/profile/account/qrCode',
  'GET /v3/profile/account/abha-card',
  'GET /v3/profile/account/request/token',
  'GET /v3/profile/account/request/logout',
  'POST /v3/profile/account/request/emailVerificationLink',
  'POST /v3/profile/account/verify',
  'POST /v3/profile/account/request/otp',
  'POST /v3/profile/account/update',
  'POST /v3/profile/account/mobile/update',
  'POST /v3/profile/account/email/update',
  'POST /v3/phr/web/login/abha/search',
  'POST /v3/phr/web/login/abha/request/otp',
  'POST /v3/phr/web/login/abha/verify',
  'GET /v3/phr/web/login/profile/abha-profile',
  'GET /v3/phr/web/login/profile/abha/phr-card',
  'GET /v3/phr/web/login/profile/abha/qr-code',
  ...PHR_APP_ABHA_OPERATIONS
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
      dependencies: req.abdmFacility.dependencies || null,
      readiness: readiness(req.abdmFacility)
    }
  });
};


exports.dependencyStatus = async (req, res) => {
  try {
    const report = sanitizeDependencyReport(req.body || {});
    req.abdmFacility.dependencies = {
      ...report,
      reportRequestId: req.abdmInternalRequestId
    };
    await req.abdmFacility.save();
    return res.json({
      success: true,
      acceptedAt: report.receivedAt,
      productionTransferReady: report.productionTransferReady,
      readiness: readiness(req.abdmFacility)
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      error: error.message
    });
  }
};

exports.proxyAbha = async (req, res) => {
  let transaction;
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

    const scopes = Array.isArray(body?.scope) ? body.scope.map(String) : [];
    const isFaceAuth =
      scopes.some((scope) => scope.toLowerCase().includes('face')) ||
      normalizedPath.includes('/capturePID') ||
      normalizedPath.endsWith('/enrol/auth/init');
    const isPhrProfile = normalizedPath.startsWith('/v3/phr/app/');
    transaction = await AbdmTransaction.create({
      requestId: req.abdmInternalRequestId || crypto.randomUUID(),
      facilityId: facilityIdentity(req),
      flow: isPhrProfile ? 'PHR_PROFILE' : (isFaceAuth ? 'M1_FACE_AUTH' : 'M1_IDENTITY'),
      direction: 'OUTBOUND',
      status: 'PROCESSING',
      correlation: {
        operation,
        module: isPhrProfile ? 'PHR_APP' : 'M1',
        faceAuth: isFaceAuth === true
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    const safeHeaders = {};
    const allowedHeaders = new Set([
      'x-token',
      'x-auth-token',
      'r-token',
      't-token',
      'transaction_id',
      'benefit-name'
    ]);
    for (const [name, value] of Object.entries(headers || {})) {
      if (allowedHeaders.has(String(name).toLowerCase()) && value) {
        safeHeaders[name] = String(value);
      }
    }

    const data = await abhaRequest(path, {
      method: normalizedMethod,
      body,
      headers: safeHeaders,
      responseType
    });

    if (transaction) {
      transaction.status = 'COMPLETED';
      await transaction.save();
    }

    if (responseType === 'buffer') {
      return res.json({
        success: true,
        dataBase64: data.buffer.toString('base64'),
        contentType: data.contentType
      });
    }

    return res.json({ success: true, data });
  } catch (error) {
    if (transaction) {
      transaction.status = 'FAILED';
      transaction.error = {
        message: error.message,
        statusCode: error.statusCode
      };
      await transaction.save().catch(() => undefined);
    }
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
      },
      SEND_LINK_SMS: {
        flow: 'HIP_LINK_SMS',
        execute: () => hip.notifyPatientLinkSms(facilityId, body, requestId)
      },
      RESPOND_RUNNING_TOKEN_STATUS: {
        flow: 'RUNNING_TOKEN_STATUS',
        execute: () => hip.respondRunningTokenStatus(facilityId, body, requestId)
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
    const { action, body, authToken, resourceId, query, lockerId } = req.body || {};
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
      LIST_CONSENT_REQUESTS: {
        flow: 'M3_CONSENT',
        execute: () => hiu.listConsentRequests(hiuId, query, requestId, authToken)
      },
      GET_CONSENT_REQUEST: {
        flow: 'M3_CONSENT',
        execute: () => hiu.getConsentRequest(hiuId, resourceId, requestId, authToken)
      },
      GET_CONSENT_ARTEFACTS_BY_REQUEST: {
        flow: 'M3_CONSENT_FETCH',
        execute: () => hiu.consentArtefactsByRequest(hiuId, resourceId, requestId, authToken)
      },
      GET_CONSENT_ARTEFACT: {
        flow: 'M3_CONSENT_FETCH',
        execute: () => hiu.getConsentArtefact(hiuId, resourceId, requestId, authToken)
      },
      LIST_CONSENT_ARTEFACTS: {
        flow: 'M3_CONSENT_FETCH',
        execute: () => hiu.listConsentArtefacts(hiuId, query, requestId, authToken)
      },
      CREATE_CONSENT_AUTO_APPROVE: {
        flow: 'M3_CONSENT',
        execute: () => hiu.createConsentAutoApprove(hiuId, body, requestId, authToken)
      },
      DISABLE_CONSENT_AUTO_APPROVE: {
        flow: 'M3_CONSENT',
        execute: () => hiu.disableConsentAutoApprove(hiuId, resourceId, requestId, authToken)
      },
      ENABLE_CONSENT_AUTO_APPROVE: {
        flow: 'M3_CONSENT',
        execute: () => hiu.enableConsentAutoApprove(hiuId, resourceId, requestId, authToken)
      },
      DENY_CONSENT_REQUEST: {
        flow: 'M3_CONSENT',
        execute: () => hiu.denyConsentRequest(hiuId, resourceId, body, requestId, authToken)
      },
      REVOKE_CONSENT: {
        flow: 'M3_CONSENT',
        execute: () => hiu.revokeConsent(hiuId, body, requestId, authToken)
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
      GET_HEALTH_INFORMATION_STATUS: {
        flow: 'M3_HEALTH_INFORMATION_REQUEST',
        execute: () => hiu.healthInformationStatus(hiuId, resourceId, requestId, authToken)
      },
      PHR_DISCOVER_HEALTH_RECORDS: {
        flow: 'USER_DISCOVERY',
        execute: () => hiu.discoverHealthRecords(hiuId, body, requestId, authToken)
      },
      PHR_LINK_CARE_CONTEXT_INIT: {
        flow: 'USER_LINK_INIT',
        execute: () => hiu.initHealthRecordLink(hiuId, body, requestId, authToken)
      },
      PHR_LINK_CARE_CONTEXT_CONFIRM: {
        flow: 'USER_LINK_CONFIRM',
        execute: () => hiu.confirmHealthRecordLink(hiuId, body, requestId, authToken)
      },
      PHR_LIST_LINKS: {
        flow: 'USER_DISCOVERY',
        execute: () => hiu.listPatientLinks(hiuId, query, requestId, authToken)
      },
      PHR_LIST_PROVIDERS: {
        flow: 'USER_DISCOVERY',
        execute: () => hiu.listProviders(hiuId, query, requestId, authToken)
      },
      PHR_GET_PROVIDER: {
        flow: 'USER_DISCOVERY',
        execute: () => hiu.getProvider(hiuId, resourceId, requestId, authToken)
      },
      PHR_GOVT_PROGRAMS: {
        flow: 'USER_DISCOVERY',
        execute: () => hiu.govtPrograms(hiuId, query, requestId, authToken)
      },
      REQUEST_RUNNING_TOKEN_STATUS: {
        flow: 'RUNNING_TOKEN_STATUS',
        execute: () => hiu.requestRunningTokenStatus(hiuId, body, requestId, authToken)
      },
      LIST_HEALTH_LOCKERS: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.listHealthLockers(hiuId, query, requestId)
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
        execute: () => hiu.acknowledgeCareContextNotification(hiuId, body, requestId)
      },
      APPROVE_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.approveSubscription(hiuId, resourceId, body, requestId, authToken)
      },
      DENY_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.denySubscription(hiuId, resourceId, body, requestId, authToken)
      },
      LIST_SUBSCRIPTION_REQUESTS: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.listSubscriptionRequests(hiuId, query, requestId, authToken)
      },
      GET_SUBSCRIPTION_REQUEST: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.getSubscriptionByRequestId(hiuId, resourceId, requestId, authToken)
      },
      GET_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.getSubscription(hiuId, resourceId, requestId, authToken)
      },
      EDIT_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.editSubscription(hiuId, resourceId, body, requestId, authToken)
      },
      DISABLE_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.disableSubscription(hiuId, resourceId, requestId, authToken)
      },
      ENABLE_SUBSCRIPTION: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.enableSubscription(hiuId, resourceId, requestId, authToken)
      },
      PATIENT_SUBSCRIPTION_REQUESTS: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.patientRequests(hiuId, query, requestId, authToken)
      },
      SETUP_HEALTH_LOCKER: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.setupLocker(hiuId, body, requestId, authToken)
      },
      LIST_PATIENT_LOCKERS: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.patientLockers(hiuId, query, requestId, authToken)
      },
      GET_PATIENT_LOCKER: {
        flow: 'M3_SUBSCRIPTION',
        execute: () => hiu.patientLocker(hiuId, lockerId || resourceId, requestId, authToken)
      }
    };

    const subscriptionActions = new Set([
      'LIST_HEALTH_LOCKERS', 'INIT_SUBSCRIPTION', 'ACK_SUBSCRIPTION', 'ACK_SUBSCRIPTION_CARE_CONTEXT',
      'APPROVE_SUBSCRIPTION', 'DENY_SUBSCRIPTION', 'LIST_SUBSCRIPTION_REQUESTS',
      'GET_SUBSCRIPTION_REQUEST', 'GET_SUBSCRIPTION', 'EDIT_SUBSCRIPTION',
      'DISABLE_SUBSCRIPTION', 'ENABLE_SUBSCRIPTION', 'PATIENT_SUBSCRIPTION_REQUESTS',
      'SETUP_HEALTH_LOCKER', 'LIST_PATIENT_LOCKERS', 'GET_PATIENT_LOCKER'
    ]);
    if (subscriptionActions.has(action) && !config.featureSubscriptions) {
      return res.status(409).json({ error: 'Subscriptions are disabled' });
    }

    const patientAuthenticatedActions = new Set([
      'REQUEST_RUNNING_TOKEN_STATUS',
      'LIST_CONSENT_REQUESTS', 'GET_CONSENT_REQUEST',
      'GET_CONSENT_ARTEFACTS_BY_REQUEST', 'GET_CONSENT_ARTEFACT',
      'LIST_CONSENT_ARTEFACTS', 'CREATE_CONSENT_AUTO_APPROVE',
      'DISABLE_CONSENT_AUTO_APPROVE', 'ENABLE_CONSENT_AUTO_APPROVE',
      'DENY_CONSENT_REQUEST', 'REVOKE_CONSENT',
      'GET_HEALTH_INFORMATION_STATUS',
      'PHR_DISCOVER_HEALTH_RECORDS', 'PHR_LINK_CARE_CONTEXT_INIT',
      'PHR_LINK_CARE_CONTEXT_CONFIRM', 'PHR_LIST_LINKS',
      'PHR_LIST_PROVIDERS', 'PHR_GET_PROVIDER', 'PHR_GOVT_PROGRAMS',
      'APPROVE_SUBSCRIPTION', 'DENY_SUBSCRIPTION',
      'LIST_SUBSCRIPTION_REQUESTS', 'GET_SUBSCRIPTION_REQUEST', 'GET_SUBSCRIPTION',
      'EDIT_SUBSCRIPTION', 'DISABLE_SUBSCRIPTION', 'ENABLE_SUBSCRIPTION',
      'PATIENT_SUBSCRIPTION_REQUESTS', 'SETUP_HEALTH_LOCKER',
      'LIST_PATIENT_LOCKERS', 'GET_PATIENT_LOCKER'
    ]);
    if (patientAuthenticatedActions.has(action) && !authToken) {
      return res.status(400).json({ error: 'A server-side ABDM patient authentication token is required' });
    }
    const resourceActions = new Set([
      'GET_CONSENT_REQUEST', 'GET_CONSENT_ARTEFACTS_BY_REQUEST',
      'GET_CONSENT_ARTEFACT', 'DISABLE_CONSENT_AUTO_APPROVE',
      'ENABLE_CONSENT_AUTO_APPROVE', 'DENY_CONSENT_REQUEST',
      'GET_HEALTH_INFORMATION_STATUS', 'PHR_GET_PROVIDER',
      'APPROVE_SUBSCRIPTION', 'DENY_SUBSCRIPTION', 'GET_SUBSCRIPTION_REQUEST',
      'GET_SUBSCRIPTION', 'EDIT_SUBSCRIPTION', 'DISABLE_SUBSCRIPTION',
      'ENABLE_SUBSCRIPTION', 'GET_PATIENT_LOCKER'
    ]);
    if (resourceActions.has(action) && !(resourceId || lockerId)) {
      return res.status(400).json({ error: 'resourceId is required' });
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
      const consentRequestId = result.data?.consentRequestId || requestId;
      await AbdmConsent.findOneAndUpdate(
        { facilityId: hiuId, consentRequestId },
        {
          facilityId: hiuId,
          consentRequestId,
          consentId: body?.consentId || `pending:${requestId}`,
          role: 'HIU',
          status: 'REQUESTED',
          abhaAddress: body?.consent?.patient?.id,
          hiTypes: body?.consent?.hiTypes || body?.consent?.permission?.hiTypes,
          purpose: body?.consent?.purpose,
          permission: body?.consent?.permission
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
