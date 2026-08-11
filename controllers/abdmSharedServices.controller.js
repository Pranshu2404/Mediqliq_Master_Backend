const shared = require('../services/abdmSharedInfrastructure.service');
const config = require('../config/abdm.config');

function jsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value || {})); } catch (_error) { return Number.MAX_SAFE_INTEGER; }
}

function assertPayloadSize(body, maxBytes, label) {
  if (jsonBytes(body) > maxBytes) {
    const error = new Error(`${label} request exceeded the configured size limit`);
    error.statusCode = 413;
    error.code = 'ABDM_SHARED_SERVICE_REQUEST_TOO_LARGE';
    throw error;
  }
}

function safeError(res, error) {
  return res.status(error.statusCode || 502).json({
    success: false,
    error: error.message,
    code: error.code,
    details: error.details
  });
}

exports.health = async (req, res) => {
  try {
    const services = await shared.sharedHealth(req.abdmFacility, req.abdmInternalRequestId);
    return res.json({ success: true, services, checkedAt: new Date().toISOString() });
  } catch (error) {
    return safeError(res, error);
  }
};

exports.validateFhir = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedFhirValidatorMaxRequestBytes, 'FHIR validation');
    const result = await shared.validateFhir(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.generateReceiverKeyMaterial = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedCryptoAdapterMaxRequestBytes, 'Crypto key-material');
    const result = await shared.generateReceiverKeyMaterial(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.encrypt = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedCryptoAdapterMaxRequestBytes, 'Crypto encryption');
    const result = await shared.encryptHealthInformation(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.decrypt = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedCryptoAdapterMaxRequestBytes, 'Crypto decryption');
    const result = await shared.decryptHealthInformation(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.validateConsent = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedConsentValidatorMaxRequestBytes, 'Consent validation');
    const result = await shared.validateConsent(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.consentUsage = async (req, res) => {
  try {
    const result = await shared.consentUsageAction(
      req.abdmFacility,
      req.body?.reservationId,
      req.params.action,
      req.abdmInternalRequestId
    );
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};

exports.consentStatusEvent = async (req, res) => {
  try {
    assertPayloadSize(req.body, config.sharedConsentValidatorMaxRequestBytes, 'Consent status event');
    const result = await shared.recordConsentStatusEvent(req.abdmFacility, req.body || {}, req.abdmInternalRequestId);
    return res.json(result);
  } catch (error) {
    return safeError(res, error);
  }
};
