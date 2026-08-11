const crypto = require('crypto');
const abdmConfig = require('../config/abdm.config');
const { notifyHealthInformation } = require('./abdmHip.service');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const { encryptHealthInformation } = require('./abdmSharedInfrastructure.service');

const fetchFn = (...args) => {
  if (typeof fetch === 'function') return fetch(...args);
  return import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
};

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function prepareEncryptedPackage(input, facility) {
  const mode = String(process.env.ABDM_DATA_PUSH_MODE || 'disabled').toLowerCase();
  if (mode === 'external') {
    if (!facility?.tenantCode) {
      throw new Error('Authenticated facility context is required for shared ABDM crypto');
    }
    return encryptHealthInformation(facility, input, `data-push:${input.transactionId || crypto.randomUUID()}`);
  }

  // ABDM data-flow crypto is intentionally fail-closed. The repository includes the transport
  // orchestration but does not guess the certification-critical Curve25519 envelope. Connect the
  // official/validated NHA-compatible crypto implementation through ABDM_CRYPTO_ADAPTER_URL.
  throw new Error(
    `ABDM health-information data push is disabled (ABDM_DATA_PUSH_MODE=${mode}). Configure a validated ABDM crypto adapter before enabling M2 data exchange.`
  );
}

async function notifyTransfer({ facilityId, consentId, transactionId, sessionStatus, careContextReferences, error }) {
  const body = {
    notification: {
      consentId,
      transactionId,
      doneAt: new Date().toISOString(),
      notifier: { type: 'HIP', id: facilityId },
      statusNotification: {
        sessionStatus,
        hipId: facilityId,
        statusResponses: (careContextReferences || []).map((referenceNumber) => ({
          careContextReference: referenceNumber,
          hiStatus: sessionStatus === 'TRANSFERRED' ? 'DELIVERED' : 'ERRORED',
          description: error || undefined
        }))
      }
    }
  };
  return notifyHealthInformation(facilityId, body);
}

async function pushHealthInformation({ facility, facilityId, consentId, transactionId, dataPushUrl, peerKeyMaterial, records }) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('No health-information records were supplied for data push');
  const careContextReferences = records.map((item) => item.careContextReference).filter(Boolean);
  try {
    const safeDataPushUrl = await assertSafeOutboundUrl(dataPushUrl, {
      label: 'ABDM data push URL',
      allowedHosts: abdmConfig.dataPushAllowedHosts,
      requireHttps: true,
      allowPrivate: false
    });
    const encrypted = await prepareEncryptedPackage({ transactionId, peerKeyMaterial, records }, facility);
    const entries = encrypted.entries.map((entry, index) => ({
      ...entry,
      media: entry.media || 'application/fhir+json',
      checksum:
        entry.checksum ||
        checksum(
          typeof records[index]?.content === 'string'
            ? records[index].content
            : JSON.stringify(records[index]?.content || {})
        )
    }));
    const response = await fetchFn(safeDataPushUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, entries, keyMaterial: encrypted.keyMaterial }),
      signal: AbortSignal.timeout(Number(process.env.ABDM_DATA_PUSH_TIMEOUT_MS || 30000)),
      redirect: 'error'
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(responseBody?.message || `HIU data push failed: ${response.status}`);
      error.details = responseBody;
      throw error;
    }
    await notifyTransfer({ facilityId, consentId, transactionId, sessionStatus: 'TRANSFERRED', careContextReferences });
    return { success: true, response: responseBody, entries: entries.length };
  } catch (error) {
    try {
      await notifyTransfer({
        facilityId,
        consentId,
        transactionId,
        sessionStatus: 'FAILED',
        careContextReferences,
        error: error.message
      });
    } catch (notifyError) {
      error.notifyError = notifyError.message;
    }
    throw error;
  }
}

module.exports = { pushHealthInformation, prepareEncryptedPackage };
