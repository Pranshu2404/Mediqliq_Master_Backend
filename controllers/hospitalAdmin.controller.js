const crypto = require('crypto');
const mongoose = require('mongoose');
const Hospital = require('../models/Hospital');
const License = require('../models/License');
const Plan = require('../models/Plan');
const { encryptSecret } = require('../utils/secretVault');
const { hydrateLicenseFromPlan, buildLicensePayload } = require('../services/licenseControl.service');
const { forwardToHospital } = require('../services/platformConnector.service');

const hospitalFields = [
  'hospitalID', 'registryNo', 'hospitalName', 'logo', 'companyName', 'licenseNumber', 'name', 'address',
  'contact', 'pinCode', 'city', 'state', 'email', 'fireNOC', 'policyDetails', 'healthBima', 'additionalInfo',
  'vitalsEnabled', 'vitalsController', 'tenantCode', 'deployment', 'onboarding'
];

function pick(body, fields) {
  const value = {};
  fields.forEach((field) => { if (body[field] !== undefined) value[field] = body[field]; });
  return value;
}
function validId(id) { return mongoose.Types.ObjectId.isValid(id); }
function escapeRegex(value = '') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function pagination(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

async function generateUniqueHospitalId() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let value = '';
    for (let i = 0; i < 2; i += 1) value += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 4; i += 1) value += digits[Math.floor(Math.random() * digits.length)];
    // eslint-disable-next-line no-await-in-loop
    if (!(await Hospital.exists({ hospitalID: value }))) return value;
  }
  throw new Error('Unable to generate a unique hospital ID');
}

function adminContact(body = {}) {
  const administrator = body.administrator || {};
  return {
    name: String(administrator.name || body.adminName || '').trim(),
    email: String(administrator.email || body.adminEmail || '').trim().toLowerCase(),
    phone: String(administrator.phone || body.adminPhone || '').trim()
  };
}

function configurePlatformConnector(hospital, input = {}) {
  const connector = input.platformConnector || {};
  const secret = connector.secret || input.platformConnectorSecret;
  const keyId = connector.keyId || input.platformConnectorKeyId;
  if (secret) {
    hospital.platformConnector.keyId = keyId || `platform-${String(hospital.tenantCode || hospital.hospitalID).toLowerCase()}`;
    hospital.platformConnector.secretEncrypted = encryptSecret(secret);
    hospital.platformConnector.status = 'PENDING';
  } else if (keyId) {
    hospital.platformConnector.keyId = keyId;
  }
}

async function ensureLicense({ hospital, commercial, actorId }) {
  const existing = await License.findOne({ hospital: hospital._id });
  if (existing) return existing;
  const input = {
    key: commercial.key,
    hospital: hospital._id,
    planId: commercial.planId,
    planCode: commercial.planCode,
    startsAt: commercial.startsAt || new Date(),
    expiresAt: commercial.expiresAt,
    status: commercial.status || 'active',
    entitlementOverrides: commercial.entitlementOverrides || {},
    issuedTo: hospital.hospitalName,
    createdBy: actorId
  };
  if (!input.planId && !input.planCode) {
    const fallback = await Plan.findOne({ code: 'CLOUD_STANDARD', active: true }) || await Plan.findOne({ active: true, internalOnly: { $ne: true } });
    if (fallback) input.planId = fallback._id;
  }
  const data = await hydrateLicenseFromPlan(input);
  if (!data.key) data.key = `MEDIQLIQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return License.create(data);
}

async function provisionHospital(hospital, license, administrator, options = {}) {
  if (!hospital.deployment?.backendUrl) {
    hospital.deployment.status = 'PLANNED';
    await hospital.save();
    return { attempted: false, reason: 'BACKEND_URL_MISSING' };
  }
  if (!hospital.platformConnector?.keyId || !['PENDING', 'ACTIVE'].includes(hospital.platformConnector?.status)) {
    hospital.deployment.status = 'PLANNED';
    hospital.deployment.lastProvisionError = 'Platform connector credentials are not configured';
    await hospital.save();
    return { attempted: false, reason: 'PLATFORM_CONNECTOR_MISSING' };
  }
  if (!administrator?.name || !administrator?.email || !administrator?.password) {
    hospital.deployment.status = 'PLANNED';
    hospital.deployment.lastProvisionError = 'Administrator name/email/password are required for provisioning';
    await hospital.save();
    return { attempted: false, reason: 'ADMIN_CREDENTIALS_MISSING' };
  }

  hospital.deployment.status = 'PROVISIONING';
  hospital.deployment.provisioningId = options.provisioningId || hospital.deployment.provisioningId || crypto.randomUUID();
  hospital.deployment.provisioningVersion = Number(options.version || hospital.deployment.provisioningVersion || 1);
  hospital.deployment.lastProvisionAttemptAt = new Date();
  hospital.deployment.lastProvisionError = undefined;
  await hospital.save();

  try {
    const payload = {
      provisioningId: hospital.deployment.provisioningId,
      version: hospital.deployment.provisioningVersion,
      hospital: {
        masterHospitalId: String(hospital._id),
        hospitalID: hospital.hospitalID,
        tenantCode: hospital.tenantCode,
        registryNo: hospital.registryNo,
        hospitalName: hospital.hospitalName,
        companyName: hospital.companyName,
        licenseNumber: hospital.licenseNumber,
        name: hospital.name,
        address: hospital.address,
        contact: hospital.contact,
        pinCode: hospital.pinCode,
        city: hospital.city,
        state: hospital.state,
        email: hospital.email,
        additionalInfo: hospital.additionalInfo,
        vitalsEnabled: hospital.vitalsEnabled,
        vitalsController: hospital.vitalsController,
        deployment: {
          frontendUrl: hospital.deployment.frontendUrl || '',
          backendUrl: hospital.deployment.backendUrl || '',
          databaseName: hospital.deployment.databaseName || '',
          environment: hospital.deployment.environment || 'production'
        },
        onboarding: hospital.onboarding || {}
      },
      administrator: {
        name: administrator.name,
        email: administrator.email,
        phone: administrator.phone,
        temporaryPassword: administrator.password
      },
      license: buildLicensePayload(license)
    };
    const result = await forwardToHospital(hospital._id, '/internal/platform/provision', payload, {
      // HMAC request IDs are unique per transport attempt. provisioningId in the
      // payload is the stable application-level idempotency key.
      timeoutMs: Number(process.env.PLATFORM_PROVISION_TIMEOUT_MS || 30000)
    });
    hospital.deployment.status = 'READY';
    hospital.deployment.provisionedAt = new Date();
    hospital.deployment.lastProvisionSuccessAt = new Date();
    hospital.deployment.lastProvisionError = undefined;
    hospital.deployment.remoteHospitalId = result.hospitalId || result.data?.hospitalId;
    hospital.deployment.remoteAdminId = result.adminId || result.data?.adminId;
    hospital.onboarding.status = 'ADMIN_PROVISIONED';
    await hospital.save();
    return { attempted: true, success: true, result };
  } catch (error) {
    hospital.deployment.status = 'PROVISIONING_FAILED';
    hospital.deployment.lastProvisionError = String(error.message || error).slice(0, 2000);
    await hospital.save();
    return { attempted: true, success: false, error: hospital.deployment.lastProvisionError };
  }
}

exports.listHospitals = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const filter = {};
    if (req.query.search) {
      const regex = new RegExp(escapeRegex(req.query.search), 'i');
      filter.$or = [{ hospitalID: regex }, { tenantCode: regex }, { hospitalName: regex }, { email: regex }, { city: regex }, { state: regex }];
    }
    const [data, total] = await Promise.all([
      Hospital.find(filter)
        .populate('createdBy', 'name email role')
        .populate('primaryAdmin', 'name email role is_active')
        .populate('abdmFacility', 'tenantCode hfr abdm connector onboardingStatus rollout')
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      Hospital.countDocuments(filter)
    ]);
    res.json({ success: true, data, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createHospital = async (req, res) => {
  let hospital;
  let license;
  try {
    const required = ['registryNo', 'hospitalName', 'name', 'address', 'contact', 'city', 'state', 'email'];
    const missing = required.filter((field) => !req.body[field]);
    if (missing.length) return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(', ')}` });

    const contact = adminContact(req.body);
    if (!contact.name || !contact.email) return res.status(400).json({ success: false, message: 'administrator name and email are required' });

    const data = pick(req.body, hospitalFields);
    if (req.body.pincode && !data.pinCode) data.pinCode = req.body.pincode;
    if (!data.hospitalID) data.hospitalID = await generateUniqueHospitalId();
    if (!data.tenantCode) data.tenantCode = data.hospitalID;
    data.createdBy = req.user._id;
    data.primaryAdminContact = contact;
    data.deployment = { ...(data.deployment || {}), status: 'PLANNED' };
    data.onboarding = { ...(data.onboarding || {}), status: 'CREATED', abdmChoice: data.onboarding?.abdmChoice || 'CONFIGURE_LATER' };

    hospital = new Hospital(data);
    configurePlatformConnector(hospital, req.body);
    await hospital.save();

    license = await ensureLicense({ hospital, commercial: req.body.commercial || {}, actorId: req.user._id });

    const administrator = {
      ...contact,
      password: req.body.administrator?.password || req.body.adminPassword
    };
    const provisioning = await provisionHospital(hospital, license, administrator);

    req.auditResource = { type: 'Hospital', id: String(hospital._id) };
    res.status(201).json({
      success: true,
      hospital,
      license,
      provisioning,
      message: provisioning.success ? 'Hospital created and provisioned' : 'Hospital created; provisioning remains pending or failed'
    });
  } catch (error) {
    if (license?._id) await License.findByIdAndDelete(license._id).catch(() => {});
    if (hospital?._id) await Hospital.findByIdAndDelete(hospital._id).catch(() => {});
    res.status(error.code === 11000 ? 409 : (error.statusCode || 500)).json({ success: false, message: error.message });
  }
};

exports.getHospital = async (req, res) => {
  if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
  const hospital = await Hospital.findById(req.params.hospitalId)
    .populate('createdBy', 'name email role')
    .populate('primaryAdmin', 'name email role is_active')
    .populate('abdmFacility', 'tenantCode hfr abdm connector onboardingStatus rollout');
  if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
  const license = await License.findOne({ hospital: hospital._id }).populate('planId');
  res.json({ success: true, hospital, license });
};

exports.updateHospital = async (req, res) => {
  try {
    if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
    const hospital = await Hospital.findById(req.params.hospitalId)
      .select('+platformConnector.secretEncrypted +platformConnector.secretEncrypted.ciphertext +platformConnector.secretEncrypted.iv +platformConnector.secretEncrypted.tag');
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    const data = pick(req.body, hospitalFields);
    Object.assign(hospital, data);
    if (req.body.primaryAdminContact) hospital.primaryAdminContact = req.body.primaryAdminContact;
    const contact = adminContact(req.body);
    if (contact.name || contact.email || contact.phone) hospital.primaryAdminContact = { ...(hospital.primaryAdminContact?.toObject?.() || hospital.primaryAdminContact || {}), ...Object.fromEntries(Object.entries(contact).filter(([, value]) => value)) };
    configurePlatformConnector(hospital, req.body);
    await hospital.save();
    req.auditResource = { type: 'Hospital', id: String(hospital._id) };
    res.json({ success: true, hospital });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.message });
  }
};

exports.provisionHospital = async (req, res) => {
  if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
  const hospital = await Hospital.findById(req.params.hospitalId);
  if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
  const license = await License.findOne({ hospital: hospital._id });
  if (!license) return res.status(409).json({ success: false, message: 'Hospital has no mapped license' });
  const contact = {
    name: req.body.administrator?.name || hospital.primaryAdminContact?.name,
    email: req.body.administrator?.email || hospital.primaryAdminContact?.email,
    phone: req.body.administrator?.phone || hospital.primaryAdminContact?.phone,
    password: req.body.administrator?.password || req.body.adminPassword
  };
  const result = await provisionHospital(hospital, license, contact, { provisioningId: req.body.provisioningId, version: req.body.version });
  res.status(result.success ? 200 : (result.attempted ? 502 : 409)).json({ success: Boolean(result.success), provisioning: result, hospital });
};

exports.rotatePlatformConnector = async (req, res) => {
  if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
  const hospital = await Hospital.findById(req.params.hospitalId);
  if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
  const secret = crypto.randomBytes(48).toString('base64url');
  const keyId = `platform-${hospital.tenantCode.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
  hospital.platformConnector.keyId = keyId;
  hospital.platformConnector.secretEncrypted = encryptSecret(secret);
  hospital.platformConnector.status = 'PENDING';
  await hospital.save();
  res.json({
    success: true,
    connector: { tenantCode: hospital.tenantCode, keyId, secret },
    warning: 'The connector secret is returned once. Store it in the hospital backend environment and do not commit it.'
  });
};

exports.checkPlatformConnector = async (req, res) => {
  if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
  const hospital = await Hospital.findById(req.params.hospitalId);
  if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
  try {
    const result = await forwardToHospital(hospital._id, '/internal/platform/health', undefined, { method: 'GET' });
    hospital.platformConnector.status = 'ACTIVE';
    hospital.platformConnector.lastHealthCheckAt = new Date();
    hospital.platformConnector.lastHealthCheckStatus = 'OK';
    hospital.platformConnector.lastHealthCheckError = undefined;
    await hospital.save();
    res.json({ success: true, result });
  } catch (error) {
    hospital.platformConnector.status = 'UNREACHABLE';
    hospital.platformConnector.lastHealthCheckAt = new Date();
    hospital.platformConnector.lastHealthCheckStatus = 'FAILED';
    hospital.platformConnector.lastHealthCheckError = error.message;
    await hospital.save().catch(() => {});
    res.status(502).json({ success: false, message: error.message });
  }
};

exports.deleteHospital = async (req, res) => {
  if (!validId(req.params.hospitalId)) return res.status(400).json({ success: false, message: 'Invalid hospital id' });
  const hospital = await Hospital.findByIdAndDelete(req.params.hospitalId);
  if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
  req.auditResource = { type: 'Hospital', id: String(hospital._id) };
  res.json({ success: true, message: 'Hospital deleted successfully; external deployment/database were not deleted' });
};
