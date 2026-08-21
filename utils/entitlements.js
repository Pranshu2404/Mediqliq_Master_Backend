const ENTITLEMENT_KEYS = Object.freeze([
  'dashboard',
  'registration_opd',
  'ipd',
  'pharmacy',
  'billing_finance',
  'laboratory',
  'radiology',
  'operation_theatre',
  'store_inventory',
  'hr_staff',
  'abdm',
  'reports',
  'masters_settings',
  'insurance_tpa',
  'nabh',
  'clinical_ai',
  'voice_dictation',
  'advanced_mis',
  'patient_media'
]);

const ENTITLEMENT_SET = new Set(ENTITLEMENT_KEYS);

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  return false;
}

function normalizeEntitlements(value = {}, options = {}) {
  const result = {};
  const defaultValue = Boolean(options.defaultValue);
  ENTITLEMENT_KEYS.forEach((key) => {
    result[key] = Object.prototype.hasOwnProperty.call(value || {}, key)
      ? booleanValue(value[key])
      : defaultValue;
  });
  return result;
}

function mergeEntitlements(base = {}, overrides = {}) {
  const normalized = normalizeEntitlements(base);
  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (ENTITLEMENT_SET.has(key) && value !== undefined && value !== null) normalized[key] = booleanValue(value);
  });
  return normalized;
}

const STANDARD_ENTITLEMENTS = Object.freeze(normalizeEntitlements({
  dashboard: true,
  registration_opd: true,
  ipd: true,
  pharmacy: true,
  billing_finance: true,
  laboratory: true,
  operation_theatre: true,
  abdm: true,
  reports: true,
  masters_settings: true,
  insurance_tpa: true,
  nabh: true
}));

const COMPLETE_ENTITLEMENTS = Object.freeze(normalizeEntitlements(
  Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, true]))
));

const FULL_ACCESS_ENTITLEMENTS = COMPLETE_ENTITLEMENTS;

const DEFAULT_PLANS = Object.freeze([
  {
    code: 'CLOUD_STANDARD',
    name: 'Cloud Hospital Standard',
    version: 1,
    active: true,
    entitlements: STANDARD_ENTITLEMENTS,
    limits: { patientMediaGb: 0, aiCallsMonthly: 0 }
  },
  {
    code: 'CLOUD_COMPLETE',
    name: 'Cloud Hospital Complete',
    version: 1,
    active: true,
    entitlements: COMPLETE_ENTITLEMENTS,
    limits: { patientMediaGb: 100, aiCallsMonthly: null }
  },
  {
    code: 'FULL_ACCESS',
    name: 'Full Access (migration/internal)',
    version: 1,
    active: true,
    entitlements: FULL_ACCESS_ENTITLEMENTS,
    limits: { patientMediaGb: 100, aiCallsMonthly: null },
    internalOnly: true
  }
]);

module.exports = {
  ENTITLEMENT_KEYS,
  ENTITLEMENT_SET,
  normalizeEntitlements,
  mergeEntitlements,
  STANDARD_ENTITLEMENTS,
  COMPLETE_ENTITLEMENTS,
  FULL_ACCESS_ENTITLEMENTS,
  DEFAULT_PLANS
};
