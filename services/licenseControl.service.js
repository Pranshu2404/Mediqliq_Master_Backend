const License = require('../models/License');
const Plan = require('../models/Plan');
const PlatformDelivery = require('../models/PlatformDelivery');
const { mergeEntitlements, normalizeEntitlements } = require('../utils/entitlements');

async function resolvePlan(input = {}) {
  let plan = null;
  if (input.planId) plan = await Plan.findById(input.planId);
  if (!plan && input.planCode) plan = await Plan.findOne({ code: String(input.planCode).trim().toUpperCase() });
  if (!plan && input.plan) plan = await Plan.findOne({ code: String(input.plan).trim().toUpperCase() });
  return plan;
}

function buildLicensePayload(license) {
  if (!license) return null;
  const raw = typeof license.toObject === 'function' ? license.toObject({ virtuals: true }) : license;
  const entitlementSnapshot = normalizeEntitlements(raw.entitlementSnapshot || raw.features || {});
  const entitlementOverrides = raw.entitlementOverrides || {};
  return {
    masterLicenseId: String(raw._id),
    key: raw.key,
    status: raw.status,
    planCode: raw.planCode || raw.plan || 'UNASSIGNED',
    planVersion: Number(raw.planVersion || 1),
    startsAt: raw.startsAt || raw.createdAt,
    expiresAt: raw.expiresAt || raw.expiryDate,
    licenseVersion: Number(raw.version || 1),
    entitlementSnapshot,
    entitlementOverrides,
    entitlements: mergeEntitlements(entitlementSnapshot, entitlementOverrides),
    limits: raw.limitsSnapshot || {},
    updatedAt: raw.updatedAt || raw.createdAt
  };
}

async function hydrateLicenseFromPlan(data, existing = null) {
  const plan = await resolvePlan(data);
  if (!plan && !existing?.planId) {
    throw Object.assign(new Error('A valid planId or planCode is required'), { statusCode: 400 });
  }

  const next = { ...data };
  const effectivePlan = plan || (existing?.planId ? await Plan.findById(existing.planId) : null);
  if (effectivePlan) {
    next.planId = effectivePlan._id;
    next.planCode = effectivePlan.code;
    next.planVersion = effectivePlan.version;
    next.plan = effectivePlan.code;
    if (!existing || data.planId || data.planCode || data.plan) {
      next.entitlementSnapshot = normalizeEntitlements(effectivePlan.entitlements || {});
      next.limitsSnapshot = effectivePlan.limits || {};
    }
  }

  if (data.entitlementOverrides !== undefined) next.entitlementOverrides = data.entitlementOverrides || {};
  if (data.expiresAt !== undefined) next.expiryDate = data.expiresAt;
  if (data.expiryDate !== undefined) next.expiresAt = data.expiryDate;
  return next;
}

async function currentLicenseForHospital(hospitalId) {
  return License.findOne({ hospital: hospitalId }).sort({ createdAt: -1 });
}

async function enqueueLicenseEvent(license) {
  if (!license?.hospital) return null;
  const populated = await License.findById(license._id).populate('hospital', 'tenantCode deployment platformConnector');
  if (!populated?.hospital?.deployment?.backendUrl) return null;
  const payload = buildLicensePayload(populated);
  const delivery = await PlatformDelivery.create({
    hospital: populated.hospital._id,
    tenantCode: populated.hospital.tenantCode,
    type: 'LICENSE_EVENT',
    path: '/internal/platform/license-event',
    payload,
    status: 'PENDING',
    nextRetryAt: new Date()
  });
  populated.delivery = {
    ...(populated.delivery || {}),
    lastPushAt: new Date(),
    lastPushStatus: 'PENDING',
    lastPushError: undefined
  };
  await populated.save().catch(() => {});
  return delivery;
}

module.exports = {
  resolvePlan,
  buildLicensePayload,
  hydrateLicenseFromPlan,
  currentLicenseForHospital,
  enqueueLicenseEvent
};
