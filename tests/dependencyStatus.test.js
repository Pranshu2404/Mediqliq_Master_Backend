const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeDependencyReport } = require('../utils/abdmDependencyStatus');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('hospital dependency report is reduced to PHI-free readiness metadata', () => {
  const report = sanitizeDependencyReport({
    reportedAt: new Date().toISOString(),
    productionTransferReady: true,
    patient: { name: 'must not survive' },
    transferReadiness: {
      cryptoMode: 'external',
      cryptoAdapterConfigured: true,
      cryptoAdapterHealthy: true,
      fhirValidatorConfigured: true,
      fhirValidatorHealthy: true,
      externalFhirValidationRequired: true,
      consentValidatorConfigured: true,
      consentValidatorHealthy: true,
      consentValidatorProductionCapable: true,
      consentValidationRequired: true,
      dataPushAllowlistConfigured: true,
      privateDataPushAllowed: false,
      cryptoAdapterUrl: 'https://secret.internal'
    },
    packetReadiness: {
      enabled: true,
      reviewPolicy: 'REQUIRED_BEFORE_TRANSFER',
      immutableVersions: true,
      encryptedBundleStorage: true,
      sourceSnapshotBinding: true,
      consentScopeBinding: true,
      approvalRequiredBeforeTransfer: true,
      bundle: { resourceType: 'Bundle' }
    },
    dependencies: {
      fhirValidator: { configured: true, healthy: true, package: 'ndhm.in#6.5.0' },
      cryptoAdapter: { configured: true, healthy: true, privateKey: 'forbidden' },
      consentValidator: {
        configured: true,
        healthy: true,
        productionCapable: true,
        trustReady: true,
        databaseReady: true,
        capabilities: { signatureVerification: true, frequencyEnforcement: true, patient: 'forbidden' },
        artefact: 'forbidden'
      }
    }
  });

  assert.equal(report.productionTransferReady, true);
  assert.equal(report.transferReadiness.cryptoMode, 'external');
  assert.equal(report.transferReadiness.cryptoAdapterUrl, undefined);
  assert.equal(report.packetReadiness.bundle, undefined);
  assert.equal(report.health.cryptoAdapter.privateKey, undefined);
  assert.equal(report.transferReadiness.consentValidatorProductionCapable, true);
  assert.equal(report.health.consentValidator.productionCapable, true);
  assert.equal(report.health.consentValidator.capabilities.signatureVerification, true);
  assert.equal(report.health.consentValidator.capabilities.patient, undefined);
  assert.equal(report.health.consentValidator.artefact, undefined);
  assert.equal(report.patient, undefined);
});

test('master exposes signed dependency status route and stores it on the facility', () => {
  const routes = source('routes/abdmInternal.routes.js');
  const model = source('models/AbdmFacility.js');
  const controller = source('controllers/abdmInternal.controller.js');
  assert.match(routes, /dependency-status/);
  assert.match(model, /productionTransferReady/);
  assert.match(model, /packetReadiness/);
  assert.match(controller, /sanitizeDependencyReport/);
});
