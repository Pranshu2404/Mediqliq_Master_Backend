function boundedString(value, max = 120) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).slice(0, max);
}

function booleansOnly(source, keys) {
  const output = {};
  for (const key of keys) {
    if (typeof source?.[key] === 'boolean') output[key] = source[key];
  }
  return output;
}

function sanitizeDependencyHealth(value = {}) {
  const output = {};
  for (const name of ['fhirValidator', 'cryptoAdapter', 'consentValidator']) {
    const item = value?.[name] || {};
    output[name] = {
      ...booleansOnly(item, ['configured', 'healthy', 'integrityCapable']),
      ...(Number.isFinite(Number(item.latencyMs))
        ? { latencyMs: Math.max(0, Math.min(60000, Number(item.latencyMs))) }
        : {}),
      version: boundedString(item.version),
      package: boundedString(item.package),
      fhirVersion: boundedString(item.fhirVersion),
      code: boundedString(item.code || item.errorCode),
      checkedAt: item.checkedAt && !Number.isNaN(new Date(item.checkedAt).getTime())
        ? new Date(item.checkedAt)
        : undefined
    };
  }
  return output;
}

function sanitizeDependencyReport(body = {}) {
  const transfer = body.transferReadiness || {};
  const packet = body.packetReadiness || {};
  const reportedAt = body.reportedAt && !Number.isNaN(new Date(body.reportedAt).getTime())
    ? new Date(body.reportedAt)
    : new Date();
  return {
    reportedAt,
    receivedAt: new Date(),
    productionTransferReady: body.productionTransferReady === true,
    transferReadiness: {
      cryptoMode: boundedString(transfer.cryptoMode, 20),
      ...booleansOnly(transfer, [
        'cryptoAdapterConfigured',
        'cryptoAdapterHealthy',
        'cryptoIntegrityRequired',
        'fhirValidatorConfigured',
        'fhirValidatorHealthy',
        'externalFhirValidationRequired',
        'consentValidatorConfigured',
        'consentValidatorHealthy',
        'consentValidationRequired',
        'dataPushAllowlistConfigured',
        'privateDataPushAllowed'
      ]),
      fhirPackage: boundedString(transfer.fhirPackage),
      fhirVersion: boundedString(transfer.fhirVersion)
    },
    packetReadiness: {
      ...booleansOnly(packet, [
        'enabled',
        'immutableVersions',
        'encryptedBundleStorage',
        'sourceSnapshotBinding',
        'consentScopeBinding',
        'approvalRequiredBeforeTransfer'
      ]),
      reviewPolicy: boundedString(packet.reviewPolicy, 40)
    },
    health: sanitizeDependencyHealth(body.dependencies || body.health),
    source: 'HOSPITAL_BACKEND'
  };
}

module.exports = {
  boundedString,
  booleansOnly,
  sanitizeDependencyHealth,
  sanitizeDependencyReport
};
