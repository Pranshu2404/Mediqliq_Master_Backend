const crypto = require('crypto');
const config = require('../config/abdm.config');
const AbdmWebhookEvent = require('../models/AbdmWebhookEvent');
const AbdmTransaction = require('../models/AbdmTransaction');
const AbdmJob = require('../models/AbdmJob');
const AbdmDataRelayToken = require('../models/AbdmDataRelayToken');
const {
  resolveFacilityId,
  getFacility
} = require('../services/abdmFacilityRouter.service');
const { canonicalJson } = require('../utils/internalSignature');

const FLOW_BY_EVENT = Object.freeze({
  PROFILE_SHARE: 'PROFILE_SHARE',
  HIP_LINK_TOKEN_CALLBACK: 'HIP_LINK_TOKEN',
  HIP_CARE_CONTEXT_LINK_CALLBACK: 'HIP_CARE_CONTEXT_LINK',
  CARE_CONTEXT_UPDATE_CALLBACK: 'CARE_CONTEXT_UPDATE',
  USER_DISCOVERY: 'USER_DISCOVERY',
  USER_LINK_INIT: 'USER_LINK_INIT',
  USER_LINK_CONFIRM: 'USER_LINK_CONFIRM',
  CONSENT_NOTIFY: 'CONSENT_NOTIFY',
  HEALTH_INFORMATION_REQUEST: 'HEALTH_INFORMATION_REQUEST',
  RUNNING_TOKEN_STATUS: 'RUNNING_TOKEN_STATUS'
});

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson(value || {}))
    .digest('hex');
}

function extractTransactionId(body = {}) {
  return (
    body.transactionId ||
    body.txnId ||
    body.hiRequest?.transactionId ||
    body.notification?.consentId ||
    body.consentId ||
    body.request?.id
  );
}

function eventFlow(eventType) {
  if (eventType === 'HIU_PATIENT_CARE_CONTEXT_ON_DISCOVER') return 'USER_DISCOVERY';
  if (eventType === 'HIU_PATIENT_CARE_CONTEXT_ON_INIT') return 'USER_LINK_INIT';
  if (eventType === 'HIU_PATIENT_CARE_CONTEXT_ON_CONFIRM') return 'USER_LINK_CONFIRM';

  if (eventType.startsWith('HIU_CONSENT')) {
    if (eventType.includes('STATUS')) return 'M3_CONSENT_STATUS';
    if (eventType.includes('FETCH')) return 'M3_CONSENT_FETCH';
    return 'M3_CONSENT';
  }

  if (eventType.startsWith('HIU_HEALTH') || eventType === 'HIU_DATA_PUSH') {
    return eventType === 'HIU_DATA_PUSH'
      ? 'M3_HEALTH_INFORMATION_RECEIVE'
      : 'M3_HEALTH_INFORMATION_REQUEST';
  }

  if (eventType.includes('SUBSCRIPTION')) return 'M3_SUBSCRIPTION';
  return FLOW_BY_EVENT[eventType] || 'OTHER';
}

function safeHeaders(headers = {}) {
  return {
    'x-hip-id': headers['x-hip-id'],
    'x-hiu-id': headers['x-hiu-id'],
    'x-cm-id': headers['x-cm-id']
  };
}

async function quarantineEvent({
  eventType,
  requestId,
  transactionId,
  payloadHash,
  headers,
  reason
}) {
  await AbdmWebhookEvent.findOneAndUpdate(
    { eventType, requestId, payloadHash },
    {
      eventType,
      requestId,
      transactionId,
      payloadHash,
      headers: safeHeaders(headers),
      processingStatus: 'QUARANTINED',
      lastError: {
        message: reason,
        at: new Date()
      }
    },
    { upsert: true }
  );
}

async function enqueueCallback({
  eventType,
  facilityId,
  requestId,
  transactionId,
  payloadHash,
  body,
  headers,
  correlation = {}
}) {
  let event;
  try {
    event = await AbdmWebhookEvent.create({
      eventType,
      facilityId,
      requestId,
      transactionId,
      payloadHash,
      payload: config.storeCallbackPayloads ? body : undefined,
      headers: safeHeaders(headers),
      processingStatus: 'RECEIVED'
    });
  } catch (error) {
    if (error.code === 11000) return { duplicate: true };
    throw error;
  }

  const transaction = await AbdmTransaction.create({
    requestId,
    transactionId,
    facilityId,
    flow: eventFlow(eventType),
    direction: 'INBOUND',
    status: 'ACCEPTED',
    correlation: {
      eventType,
      ...correlation
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  await AbdmJob.create({
    type: 'PROCESS_ABDM_CALLBACK',
    facilityId,
    payload: {
      eventId: event._id,
      transactionDbId: transaction._id,
      facilityId,
      eventType,
      body,
      headers: safeHeaders(headers)
    },
    runAfter: new Date()
  });

  event.processingStatus = 'ROUTED';
  await event.save();
  return { event, transaction, duplicate: false };
}

function callback(eventType) {
  return async (req, res) => {
    const requestId =
      req.headers['request-id'] ||
      req.headers['x-request-id'] ||
      crypto.randomUUID();
    const transactionId = extractTransactionId(req.body);
    const payloadHash = sha256(req.body);

    try {
      const facilityId = await resolveFacilityId({
        headers: req.headers,
        body: req.body,
        requestId,
        transactionId
      });

      if (!facilityId || !(await getFacility(facilityId))) {
        await quarantineEvent({
          eventType,
          requestId,
          transactionId,
          payloadHash,
          headers: req.headers,
          reason: 'Unable to resolve active facility'
        });
        return res.status(202).json({ status: 'accepted' });
      }

      const result = await enqueueCallback({
        eventType,
        facilityId,
        requestId,
        transactionId,
        payloadHash,
        body: req.body,
        headers: req.headers
      });

      return res.status(202).json({
        status: 'accepted',
        ...(result.duplicate ? { duplicate: true } : {})
      });
    } catch (error) {
      // ABDM callbacks are acknowledged to prevent uncontrolled gateway retries.
      // The error is retained in logs/quarantine state for operations review.
      console.error(`Callback ${eventType} failed:`, error);
      return res.status(202).json({ status: 'accepted' });
    }
  };
}

exports.hiuDataRelay = async (req, res) => {
  const tokenHash = crypto
    .createHash('sha256')
    .update(String(req.params.relayToken || ''))
    .digest('hex');
  const payloadHash = sha256(req.body);

  try {
    const relay = await AbdmDataRelayToken.findOne({
      tokenHash,
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() }
    }).select('+tokenHash');

    if (!relay || relay.pushCount >= relay.maxPushes) {
      return res.status(404).json({
        error: 'Unknown or expired data-push destination'
      });
    }

    const requestId =
      req.headers['request-id'] ||
      req.headers['x-request-id'] ||
      crypto.randomUUID();
    const transactionId = req.body?.transactionId;

    const result = await enqueueCallback({
      eventType: 'HIU_DATA_PUSH',
      facilityId: relay.facilityId,
      requestId,
      transactionId,
      payloadHash,
      body: req.body,
      headers: req.headers,
      correlation: { relayId: relay._id }
    });

    if (!result.duplicate) {
      relay.pushCount += 1;
      relay.transactionId = relay.transactionId || transactionId;
      if (relay.pushCount >= relay.maxPushes || req.body?.isLast === true) {
        relay.status = 'USED';
      }
      await relay.save();
    }

    return res.status(202).json({
      status: 'accepted',
      ...(result.duplicate ? { duplicate: true } : {})
    });
  } catch (error) {
    console.error('HIU data relay failed:', error);
    return res.status(500).json({
      error: 'Unable to accept health-information payload'
    });
  }
};

exports.profileShare = callback('PROFILE_SHARE');
exports.linkTokenCallback = callback('HIP_LINK_TOKEN_CALLBACK');
exports.linkCareContextCallback = callback('HIP_CARE_CONTEXT_LINK_CALLBACK');
exports.careContextUpdateCallback = callback('CARE_CONTEXT_UPDATE_CALLBACK');
exports.smsNotifyCallback = callback('SMS_NOTIFY_CALLBACK');
exports.runningTokenStatus = callback('RUNNING_TOKEN_STATUS');
exports.userDiscovery = callback('USER_DISCOVERY');
exports.userLinkInit = callback('USER_LINK_INIT');
exports.userLinkConfirm = callback('USER_LINK_CONFIRM');
exports.consentNotify = callback('CONSENT_NOTIFY');
exports.healthInformationRequest = callback('HEALTH_INFORMATION_REQUEST');
exports.hiuConsentOnInit = callback('HIU_CONSENT_ON_INIT');
exports.hiuConsentNotify = callback('HIU_CONSENT_NOTIFY');
exports.hiuConsentOnStatus = callback('HIU_CONSENT_ON_STATUS');
exports.hiuConsentOnFetch = callback('HIU_CONSENT_ON_FETCH');
exports.hiuHealthInformationOnRequest = callback(
  'HIU_HEALTH_INFORMATION_ON_REQUEST'
);
exports.hiuDataPush = callback('HIU_DATA_PUSH');
exports.hiuPatientCareContextOnDiscover = callback('HIU_PATIENT_CARE_CONTEXT_ON_DISCOVER');
exports.hiuPatientCareContextOnInit = callback('HIU_PATIENT_CARE_CONTEXT_ON_INIT');
exports.hiuPatientCareContextOnConfirm = callback('HIU_PATIENT_CARE_CONTEXT_ON_CONFIRM');
exports.hiuSubscriptionOnInit = callback('HIU_SUBSCRIPTION_ON_INIT');
exports.hiuSubscriptionNotify = callback('HIU_SUBSCRIPTION_NOTIFY');
exports.hiuCareContextNotify = callback(
  'HIU_SUBSCRIPTION_CARE_CONTEXT_NOTIFY'
);
