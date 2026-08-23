'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFreeText, cloneAndRedact } = require('../utils/sensitiveData');

test('Master support/audit DLP redacts identifiers and rejects secrets', () => {
  const input = 'Patient ABHA 91-1234-5678-9012, address patient123@abdm, OTP: 123456';
  const out = sanitizeFreeText(input, { mode: 'support' });
  assert.equal(out.rejected, true);
  assert.ok(!out.value.includes('91-1234-5678-9012'));
  assert.ok(!out.value.includes('123456'));
  const audit = cloneAndRedact({ abhaAddress: 'patient123@abdm', Authorization: 'Bearer aaa.bbb.ccc' });
  assert.ok(!JSON.stringify(audit).includes('patient123@abdm'));
});
