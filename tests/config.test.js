const test = require('node:test');
const assert = require('node:assert/strict');

test('master role is fixed', () => {
  const config = require('../config/abdm.config');
  assert.equal(config.appRole, 'ABDM_MASTER');
  assert.equal(config.isMaster, true);
  assert.equal(config.isHospital, false);
});
