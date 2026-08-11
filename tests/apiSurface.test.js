const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync(
  require.resolve('../routes/mediqliqSuperAdmin.routes'),
  'utf8'
);
const internal = fs.readFileSync(
  require.resolve('../routes/abdmInternal.routes'),
  'utf8'
);
const app = fs.readFileSync(require.resolve('../app'), 'utf8');

test('existing master frontend API groups are mounted', () => {
  const routes = [
    '/auth/login',
    '/dashboard/stats',
    '/abdm/overview',
    '/abdm/shared-services/health',
    '/abdm/facilities',
    '/abdm/consents',
    '/abdm/jobs',
    '/abdm/transactions',
    '/abdm/webhook-events',
    '/hospitals',
    '/licenses',
    '/users',
    '/audit-logs'
  ];
  for (const route of routes) assert.ok(admin.includes(route), route);
});

test('M1 M2 M3 connector surfaces exist', () => {
  const routes = [
    '/m1/proxy',
    '/m2/action',
    '/m3/action',
    '/m3/data-relay-token',
    '/shared/fhir/validate',
    '/shared/crypto/encrypt',
    '/shared/consent/validate'
  ];
  for (const route of routes) assert.ok(internal.includes(route), route);
});

test('hospital clinical routes are not mounted', () => {
  const routes = [
    '/api/patients',
    '/api/pharmacy',
    '/api/ipd',
    '/api/prescriptions'
  ];
  for (const route of routes) assert.equal(app.includes(route), false, route);
});
