const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = fs.readFileSync(require.resolve('../routes/abdmInternal.routes'), 'utf8');
const adminRoutes = fs.readFileSync(require.resolve('../routes/mediqliqSuperAdmin.routes'), 'utf8');
const guard = fs.readFileSync(require.resolve('../middlewares/sharedAbdmServiceGuard'), 'utf8');
const service = fs.readFileSync(require.resolve('../services/abdmSharedInfrastructure.service'), 'utf8');
const reservationModel = fs.readFileSync(require.resolve('../models/AbdmConsentUsageReservation'), 'utf8');
const internalAuth = fs.readFileSync(require.resolve('../middlewares/internalAbdmAuth'), 'utf8');
const dataFlow = fs.readFileSync(require.resolve('../services/abdmDataFlow.service'), 'utf8');
const cryptoFacade = fs.readFileSync(path.join(__dirname, '../apps/crypto-adapter/facade/server.js'), 'utf8');
const consentModels = fs.readFileSync(path.join(__dirname, '../apps/consent-validator/src/models.js'), 'utf8');
const consentApp = fs.readFileSync(path.join(__dirname, '../apps/consent-validator/src/app.js'), 'utf8');
const fhirRoute = fs.readFileSync(path.join(__dirname, '../apps/fhir-validator/src/jvmMain/kotlin/controller/validation/ValidationModule.kt'), 'utf8');

test('shared FHIR/crypto/consent surfaces are HMAC-protected internal routes', () => {
  for (const route of [
    '/shared/health',
    '/shared/fhir/validate',
    '/shared/crypto/receiver-key-material',
    '/shared/crypto/encrypt',
    '/shared/crypto/decrypt',
    '/shared/consent/validate',
    '/shared/consent/usage/:action',
    '/shared/consent/status-events'
  ]) assert.ok(routes.includes(route), route);
  assert.ok(routes.indexOf('router.use(verifyMasterInbound)') < routes.indexOf("'/shared/fhir/validate'"));
});

test('super-admin can monitor shared service health without exposing private routes', () => {
  assert.ok(adminRoutes.includes("'/abdm/shared-services/health'"));
});

test('shared service audit deliberately does not persist request body', () => {
  assert.ok(guard.includes('Deliberately do not store request bodies'));
  assert.equal(/request:\s*\{[\s\S]*?body:\s*req\.body/.test(guard), false);
});

test('tenant identity is forwarded from authenticated facility context, not payload selectors', () => {
  assert.ok(service.includes("headers['X-MediQliq-Tenant-Code'] = facility.tenantCode"));
  assert.ok(service.includes("headers['X-MediQliq-Facility-ID'] = facilityIdentity(facility)"));
  assert.ok(service.includes('stripUntrustedTenantSelectors'));
  assert.ok(service.includes('delete safe.tenantCode'));
  assert.ok(service.includes('delete safe.facilityId'));
});

test('consent reservations are one-way hashed and tenant/facility scoped', () => {
  assert.ok(service.includes("createHash('sha256')"));
  assert.ok(service.includes('tenantCode: facility.tenantCode'));
  assert.ok(service.includes('facilityId: facilityIdentity(facility)'));
  assert.ok(reservationModel.includes('reservationHash'));
  assert.ok(reservationModel.includes('tenantCode'));
  assert.ok(reservationModel.includes('facilityId'));
  assert.ok(consentModels.includes('tenantKey'));
  assert.ok(consentApp.includes("req.headers['x-mediqliq-tenant-code']"));
  assert.ok(consentApp.includes("req.headers['x-mediqliq-facility-id']"));
});

test('private crypto key handles are bound to tenant and facility', () => {
  assert.ok(cryptoFacade.includes('handleAad(tenant)'));
  assert.ok(cryptoFacade.includes('${tenant.tenantCode}:${tenant.facilityId}'));
  assert.ok(cryptoFacade.includes('KEY_HANDLE_TENANT_MISMATCH'));
  assert.ok(service.includes('ABDM_CRYPTO_PRIVATE_MATERIAL_FORBIDDEN'));
});

test('FHIR validate route accepts only authenticated Master tenant requests', () => {
  assert.ok(fhirRoute.includes('MEDIQLIQ_SERVICE_TOKEN'));
  assert.ok(fhirRoute.includes('X-MediQliq-Service-Identity'));
  assert.ok(fhirRoute.includes('X-MediQliq-Tenant-Code'));
  assert.ok(fhirRoute.includes('X-MediQliq-Facility-ID'));
});

test('pending connectors may check shared health but cannot use compute routes', () => {
  assert.ok(internalAuth.includes("startsWith('/internal/abdm/shared/health')"));
  assert.equal(internalAuth.includes("startsWith('/internal/abdm/shared/fhir')"), false);
});

test('Master-originated HIP data push uses the same tenant-aware shared crypto client', () => {
  assert.ok(dataFlow.includes("require('./abdmSharedInfrastructure.service')"));
  assert.ok(dataFlow.includes('encryptHealthInformation(facility'));
});
