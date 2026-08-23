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

test('canonical JSON serializes Date values as ISO strings', () => {
  const date = new Date('2026-08-23T07:11:14.283Z');
  assert.equal(
    stableBody({ updatedAt: date }),
    '{"updatedAt":"2026-08-23T07:11:14.283Z"}'
  );
});

test('canonical JSON rejects invalid Date values', () => {
  assert.throws(
    () => stableBody({ updatedAt: new Date('invalid') }),
    /invalid Date/i
  );
});
