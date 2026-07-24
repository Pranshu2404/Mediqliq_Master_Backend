const AbdmJob = require('../models/AbdmJob');
const AbdmTransaction = require('../models/AbdmTransaction');
const AbdmWebhookEvent = require('../models/AbdmWebhookEvent');
const AbdmConsent = require('../models/AbdmConsent');
const AbdmHiuRequest = require('../models/AbdmHiuRequest');
const {
  getFacility,
  forwardToHospital
} = require('./abdmFacilityRouter.service');
const hip = require('./abdmHip.service');
const hiu = require('./abdmHiu.service');
const { upsertConsentFromCallback } = require('./abdmConsentStore.service');
const { pushHealthInformation } = require('./abdmDataFlow.service');

const CONNECTOR_PATH_BY_EVENT = Object.freeze({
  PROFILE_SHARE: '/internal/abdm/profile-share',
  HIP_LINK_TOKEN_CALLBACK: '/internal/abdm/link-token',
  HIP_CARE_CONTEXT_LINK_CALLBACK: '/internal/abdm/link-care-context',
  CARE_CONTEXT_UPDATE_CALLBACK: '/internal/abdm/care-context-update',
  SMS_NOTIFY_CALLBACK: '/internal/abdm/sms-notify',
  USER_DISCOVERY: '/internal/abdm/discover',
  USER_LINK_INIT: '/internal/abdm/link/init',
  USER_LINK_CONFIRM: '/internal/abdm/link/confirm',
  CONSENT_NOTIFY: '/internal/abdm/consent/notify',
  HEALTH_INFORMATION_REQUEST: '/internal/abdm/health-information/request',
  HIU_CONSENT_ON_INIT: '/internal/abdm/hiu/consent/on-init',
  HIU_CONSENT_NOTIFY: '/internal/abdm/hiu/consent/notify',
  HIU_CONSENT_ON_STATUS: '/internal/abdm/hiu/consent/on-status',
  HIU_CONSENT_ON_FETCH: '/internal/abdm/hiu/consent/on-fetch',
  HIU_HEALTH_INFORMATION_ON_REQUEST:
    '/internal/abdm/hiu/health-information/on-request',
  HIU_DATA_PUSH: '/internal/abdm/hiu/data',
  HIU_SUBSCRIPTION_ON_INIT: '/internal/abdm/hiu/subscription/on-init',
  HIU_SUBSCRIPTION_NOTIFY: '/internal/abdm/hiu/subscription/notify',
  HIU_SUBSCRIPTION_CARE_CONTEXT_NOTIFY:
    '/internal/abdm/hiu/subscription/care-context/notify'
});

const OUTBOUND_ACTIONS = Object.freeze({
  ACK_PROFILE_SHARE: hip.acknowledgeProfileShare,
  LINK_CARE_CONTEXT: hip.linkCareContext,
  RESPOND_DISCOVERY: hip.respondDiscovery,
  RESPOND_LINK_INIT: hip.respondLinkInit,
  RESPOND_LINK_CONFIRM: hip.respondLinkConfirm,
  NOTIFY_CARE_CONTEXT_UPDATE: hip.notifyCareContextUpdate,
  ACK_CONSENT: hip.acknowledgeConsent,
  ACK_HEALTH_INFORMATION: hip.acknowledgeHealthInformationRequest,
  NOTIFY_HEALTH_INFORMATION: hip.notifyHealthInformation,
  HIU_ACK_CONSENT_NOTIFY: hiu.acknowledgeConsentNotify,
  HIU_NOTIFY_HEALTH_INFORMATION: hiu.notifyHealthInformation,
  HIU_ACK_SUBSCRIPTION: hiu.acknowledgeSubscription,
  HIU_ACK_SUBSCRIPTION_CARE_CONTEXT:
    hiu.acknowledgeCareContextNotification
});

async function executeOutbound(facilityId, items = []) {
  const results = [];

  for (const item of items) {
    const handler = OUTBOUND_ACTIONS[item.action];
    if (!handler) {
      throw new Error(`Unsupported outbound action: ${item.action}`);
    }

    if (item.action === 'LINK_CARE_CONTEXT') {
      // eslint-disable-next-line no-await-in-loop
      results.push(
        await hip.linkCareContext(
          facilityId,
          item.linkToken,
          item.body,
          item.requestId
        )
      );
    } else {
      // eslint-disable-next-line no-await-in-loop
      results.push(
        await handler(facilityId, item.body, item.requestId)
      );
    }
  }

  return results;
}

function normalizedConsentStatus(body = {}) {
  const value = String(
    body.status ||
      body.consentRequest?.status ||
      body.notification?.status ||
      'PENDING'
  ).toUpperCase();

  const allowed = new Set([
    'GRANTED',
    'DENIED',
    'REVOKED',
    'EXPIRED',
    'REQUESTED',
    'PENDING'
  ]);
  return allowed.has(value) ? value : 'PENDING';
}

async function updateM3Metadata(eventType, facilityId, body = {}) {
  const consentId =
    body.consent?.id ||
    body.consentId ||
    body.consentArtefact?.id ||
    body.notification?.consentId;
  const consentRequestId =
    body.request?.id ||
    body.consentRequest?.id ||
    body.consentRequestId;

  if (
    eventType.startsWith('HIU_CONSENT') &&
    (consentId || consentRequestId)
  ) {
    const queryOptions = [
      ...(consentId ? [{ consentId }] : []),
      ...(consentRequestId ? [{ consentRequestId }] : [])
    ];

    await AbdmConsent.findOneAndUpdate(
      {
        facilityId,
        $or: queryOptions
      },
      {
        $set: {
          facilityId,
          role: 'HIU',
          consentId: consentId || `pending:${consentRequestId}`,
          consentRequestId,
          status: normalizedConsentStatus(body),
          artefactId: body.consentArtefact?.id,
          rawReference: {
            requestId: body.requestId
          }
        }
      },
      { upsert: true }
    );
  }

  if (eventType === 'HIU_HEALTH_INFORMATION_ON_REQUEST') {
    const transactionId = body.hiRequest?.transactionId || body.transactionId;
    const requestId = body.response?.requestId || body.requestId;
    const queryOptions = [
      ...(requestId ? [{ requestId }] : []),
      ...(transactionId ? [{ transactionId }] : [])
    ];

    if (queryOptions.length) {
      await AbdmHiuRequest.findOneAndUpdate(
        {
          facilityId,
          $or: queryOptions
        },
        {
          $set: {
            facilityId,
            requestId: requestId || transactionId,
            transactionId,
            consentId,
            status: body.error ? 'FAILED' : 'ACKNOWLEDGED',
            error: body.error
          }
        },
        { upsert: true }
      );
    }
  }

  if (eventType === 'HIU_DATA_PUSH' && body.transactionId) {
    await AbdmHiuRequest.findOneAndUpdate(
      {
        facilityId,
        transactionId: body.transactionId
      },
      {
        $set: {
          status: 'DATA_RECEIVED'
        }
      }
    );
  }
}

async function consentForHipEvent(eventType, facilityId, body = {}) {
  if (eventType === 'CONSENT_NOTIFY') {
    return upsertConsentFromCallback(facilityId, body);
  }

  if (eventType === 'HEALTH_INFORMATION_REQUEST') {
    const consentId = body.hiRequest?.consent?.id;
    if (consentId) {
      return AbdmConsent.findOne({
        consentId,
        facilityId
      }).lean();
    }
  }

  return null;
}

async function processAbdmJob(job) {
  const {
    facilityId,
    eventId,
    eventType,
    body,
    headers,
    transactionDbId
  } = job.payload || {};

  const facility = await getFacility(facilityId);
  if (!facility) {
    throw new Error(`No active facility for ${facilityId}`);
  }

  const connectorPath = CONNECTOR_PATH_BY_EVENT[eventType];
  if (!connectorPath) {
    throw new Error(`No connector path for ${eventType}`);
  }

  const consent = await consentForHipEvent(eventType, facilityId, body);
  await updateM3Metadata(eventType, facilityId, body);

  const connectorResponse = await forwardToHospital(
    facility,
    connectorPath,
    {
      eventType,
      body,
      headers,
      consent,
      receivedAt: job.createdAt
    },
    { requestId: job._id.toString() }
  );

  const outboundResults = await executeOutbound(
    facilityId,
    connectorResponse.outbound || []
  );

  let dataPushResult;
  if (connectorResponse.healthDataRequest) {
    dataPushResult = await pushHealthInformation({
      facilityId,
      ...connectorResponse.healthDataRequest
    });
  }

  if (eventId) {
    await AbdmWebhookEvent.findByIdAndUpdate(eventId, {
      processingStatus: 'COMPLETED',
      processedAt: new Date(),
      $inc: { attempts: 1 }
    });
  }

  if (transactionDbId) {
    await AbdmTransaction.findByIdAndUpdate(transactionDbId, {
      status: 'COMPLETED',
      correlation: {
        connectorResult: connectorResponse.summary,
        outboundCount: outboundResults.length
      }
    });
  }

  if (eventType === 'HIU_DATA_PUSH' && body?.transactionId) {
    await AbdmHiuRequest.findOneAndUpdate(
      {
        facilityId,
        transactionId: body.transactionId
      },
      {
        $set: { status: 'FORWARDED' }
      }
    );
  }

  return {
    connectorResponse,
    outboundResults,
    dataPushResult
  };
}

async function markJobFailed(job, error) {
  const attempts = Number(job.attempts || 0) + 1;
  const maxAttempts = Number(
    job.maxAttempts || process.env.ABDM_JOB_MAX_ATTEMPTS || 5
  );
  const dead = attempts >= maxAttempts;

  await AbdmJob.findByIdAndUpdate(job._id, {
    status: dead ? 'DEAD' : 'PENDING',
    attempts,
    runAfter: new Date(
      Date.now() + Math.min(2 ** attempts * 30000, 30 * 60 * 1000)
    ),
    lastError: {
      message: error.message,
      at: new Date()
    },
    lockedAt: null
  });

  if (job.payload?.eventId) {
    await AbdmWebhookEvent.findByIdAndUpdate(job.payload.eventId, {
      processingStatus: dead ? 'FAILED' : 'RECEIVED',
      lastError: {
        message: error.message,
        at: new Date()
      },
      $inc: { attempts: 1 }
    });
  }

  if (job.payload?.transactionDbId) {
    await AbdmTransaction.findByIdAndUpdate(job.payload.transactionDbId, {
      status: dead ? 'FAILED' : 'PROCESSING',
      error: {
        message: error.message,
        at: new Date()
      }
    });
  }
}

module.exports = {
  processAbdmJob,
  markJobFailed
};
