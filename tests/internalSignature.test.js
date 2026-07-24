const test = require('node:test');
const assert = require('node:assert/strict');
const { stableBody, signRequest } = require('../utils/internalSignature');

test('canonical JSON is key-order independent', () => {
  assert.equal(
    stableBody({ b: 2, a: { d: 4, c: 3 } }),
    stableBody({ a: { c: 3, d: 4 }, b: 2 })
  );
});

test('signature changes when body changes', () => {
  const base = {
    timestamp: '2026-01-01T00:00:00Z',
    requestId: 'r',
    method: 'POST',
    path: '/internal/abdm/m1/proxy'
  };
  assert.notEqual(
    signRequest('s', { ...base, body: { a: 1 } }),
    signRequest('s', { ...base, body: { a: 2 } })
  );
});
