const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('M1 proxy allow-list contains official refresh, profile, address and optional login flows', () => {
  const controller = source('controllers/abdmInternal.controller.js');
  for (const operation of [
    'GET /v3/profile/account/request/token',
    'GET /v3/profile/account/request/logout',
    'GET /v3/profile/account',
    'GET /v3/enrollment/enrol/suggestion',
    'POST /v3/enrollment/enrol/abha-address',
    'POST /v3/enrollment/enrol/byDocument',
    'POST /v3/enrollment/enrol/auth/init',
    'POST /v3/enrollment/enrol/capturePID',
    'POST /v3/profile/login/search',
    'POST /v3/profile/login/verify/user'
  ]) {
    assert.ok(controller.includes(`'${operation}'`), `${operation} must be allow-listed`);
  }
});

test('M2 deep-link and running-token endpoints match the V3 collection', () => {
  const hip = source('services/abdmHip.service.js');
  assert.match(hip, /\/hip\/v3\/link\/patient\/links\/sms\/notify2/);
  assert.match(hip, /\/patient-share\/v3\/running-token\/on-status/);
  assert.match(hip, /timestamp: body\?\.timestamp \|\| new Date\(\)\.toISOString\(\)/);
});

test('M3 calls exact status, fetch, request and notify paths', () => {
  const hiu = source('services/abdmHiu.service.js');
  for (const endpoint of [
    '/consent/v3/request/status',
    '/consent/v3/fetch',
    '/data-flow/v3/health-information/request',
    '/data-flow/v3/health-information/notify'
  ]) {
    assert.ok(hiu.includes(endpoint), `${endpoint} must be implemented`);
  }
});

test('official bridge-service registration and subscription lifecycle are implemented', () => {
  const config = source('config/abdm.config.js');
  const http = source('services/abdmHttp.service.js');
  const hiu = source('services/abdmHiu.service.js');
  assert.match(config, /apihspsbx\.abdm\.gov\.in\/v4\/int\/v1\/bridges\/MutipleHRPAddUpdateServices/);
  assert.match(http, /registerBridgeServices/);
  assert.match(http, /abdmConfig\.facilityRegistrationToken \|\| \(await getGatewayToken\(\)\)/);
  assert.match(hiu, /subscription-requests\/v3\/init/);
  assert.match(hiu, /setup-locker/);
});

test('public callback metadata does not persist patient authentication tokens', () => {
  const publicController = source('controllers/abdmPublic.controller.js');
  assert.doesNotMatch(publicController, /'x-auth-token': req\.headers\['x-auth-token'\]/);
});

test('PHR V3 app registration, login and profile operations are allow-listed', () => {
  const capabilities = source('config/abdmPhrCapabilities.js');
  for (const operation of [
    'POST /v3/phr/app/enrollment/request/otp',
    'POST /v3/phr/app/enrollment/verify',
    'POST /v3/phr/app/enrollment/enrol',
    'POST /v3/phr/app/login/request/otp',
    'POST /v3/phr/app/login/verify',
    'POST /v3/phr/app/login/verify/user',
    'GET /v3/phr/app/login/profile',
    'GET /v3/phr/app/login/profile/qrCode',
    'GET /v3/phr/app/login/profile/phrCard',
    'GET /v3/phr/app/login/profile/request/token',
    'GET /v3/phr/app/login/profile/request/logout'
  ]) assert.ok(capabilities.includes(`'${operation}'`), `${operation} must be declared`);
});

test('PHR V3 patient consent lifecycle and user-initiated linking actions are implemented', () => {
  const controller = source('controllers/abdmInternal.controller.js');
  const hiu = source('services/abdmHiu.service.js');
  for (const action of [
    'LIST_CONSENT_REQUESTS', 'GET_CONSENT_REQUEST', 'GET_CONSENT_ARTEFACTS_BY_REQUEST',
    'GET_CONSENT_ARTEFACT', 'LIST_CONSENT_ARTEFACTS', 'CREATE_CONSENT_AUTO_APPROVE',
    'DISABLE_CONSENT_AUTO_APPROVE', 'ENABLE_CONSENT_AUTO_APPROVE', 'DENY_CONSENT_REQUEST',
    'REVOKE_CONSENT', 'GET_HEALTH_INFORMATION_STATUS', 'PHR_DISCOVER_HEALTH_RECORDS',
    'PHR_LINK_CARE_CONTEXT_INIT', 'PHR_LINK_CARE_CONTEXT_CONFIRM', 'PHR_LIST_PROVIDERS'
  ]) assert.ok(controller.includes(action), `${action} must be routed`);
  for (const endpoint of [
    '/consent/v3/auto/approve', '/consent/v3/revoke',
    '/data-flow/v3/health-information/request/status/',
    '/user-initiated-linking/v3/patient/care-context/discover',
    '/user-initiated-linking/v3/link/care-context/init',
    '/user-initiated-linking/v3/link/care-context/confirm',
    '/gateway/v3/providers'
  ]) assert.ok(hiu.includes(endpoint), `${endpoint} must be implemented`);
});

test('PHR patient user-initiated linking callbacks are publicly routed', () => {
  const routes = source('routes/abdmPublic.routes.js');
  const processor = source('services/abdmCallbackProcessor.service.js');
  for (const callbackPath of [
    '/hiu/patient/care-context/on-discover',
    '/hiu/patient/care-context/on-init',
    '/hiu/patient/care-context/on-confirm'
  ]) assert.ok(routes.includes(callbackPath), `${callbackPath} callback must exist`);
  for (const connectorPath of [
    '/internal/abdm/hiu/patient/care-context/on-discover',
    '/internal/abdm/hiu/patient/care-context/on-init',
    '/internal/abdm/hiu/patient/care-context/on-confirm'
  ]) assert.ok(processor.includes(connectorPath), `${connectorPath} connector route must exist`);
});
