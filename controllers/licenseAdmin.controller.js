const crypto = require('crypto');
const mongoose = require('mongoose');
const License = require('../models/License');
const { hydrateLicenseFromPlan, enqueueLicenseEvent } = require('../services/licenseControl.service');

function validId(id) { return mongoose.Types.ObjectId.isValid(id); }
function escapeRegex(value = '') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function generatedKey() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MEDIQLIQ-${part()}-${part()}-${part()}`;
}

exports.listLicenses = async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.plan) filter.planCode = String(req.query.plan).toUpperCase();
  if (req.query.hospitalId && validId(req.query.hospitalId)) filter.hospital = req.query.hospitalId;
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ key: regex }, { planCode: regex }, { issuedTo: regex }];
  }
  const [data, total] = await Promise.all([
    License.find(filter).populate('hospital', 'hospitalID tenantCode hospitalName email city state deployment').populate('planId').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    License.countDocuments(filter)
  ]);
  res.json({ success: true, data, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 } });
};

exports.createLicense = async (req, res) => {
  try {
    if (!req.body.hospital || !validId(req.body.hospital)) return res.status(400).json({ success: false, message: 'A valid hospital is required' });
    if (await License.exists({ hospital: req.body.hospital })) return res.status(409).json({ success: false, message: 'Hospital already has a license' });
    const input = await hydrateLicenseFromPlan({ ...req.body, key: req.body.key || generatedKey(), createdBy: req.user._id });
    const license = await License.create(input);
    await enqueueLicenseEvent(license).catch(() => {});
    req.auditResource = { type: 'License', id: String(license._id) };
    res.status(201).json({ success: true, license });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : (error.statusCode || 400)).json({ success: false, message: error.message });
  }
};

exports.getLicense = async (req, res) => {
  if (!validId(req.params.licenseId)) return res.status(400).json({ success: false, message: 'Invalid license id' });
  const license = await License.findById(req.params.licenseId).populate('hospital', 'hospitalID tenantCode hospitalName email city state deployment').populate('planId');
  if (!license) return res.status(404).json({ success: false, message: 'License not found' });
  res.json({ success: true, license });
};

exports.updateLicense = async (req, res) => {
  try {
    if (!validId(req.params.licenseId)) return res.status(400).json({ success: false, message: 'Invalid license id' });
    const license = await License.findById(req.params.licenseId);
    if (!license) return res.status(404).json({ success: false, message: 'License not found' });
    const input = await hydrateLicenseFromPlan(req.body, license);
    const mutable = ['key', 'hospital', 'planId', 'planCode', 'planVersion', 'plan', 'startsAt', 'expiresAt', 'expiryDate', 'status', 'entitlementSnapshot', 'entitlementOverrides', 'limitsSnapshot', 'issuedTo', 'notes', 'metadata'];
    mutable.forEach((key) => { if (input[key] !== undefined) license[key] = input[key]; });
    license.updatedBy = req.user._id;
    license.version = Number(license.version || 0) + 1;
    await license.save();
    await enqueueLicenseEvent(license).catch(() => {});
    req.auditResource = { type: 'License', id: String(license._id) };
    res.json({ success: true, license });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : (error.statusCode || 400)).json({ success: false, message: error.message });
  }
};

exports.deleteLicense = async (req, res) => {
  if (!validId(req.params.licenseId)) return res.status(400).json({ success: false, message: 'Invalid license id' });
  const license = await License.findByIdAndDelete(req.params.licenseId);
  if (!license) return res.status(404).json({ success: false, message: 'License not found' });
  req.auditResource = { type: 'License', id: String(license._id) };
  res.json({ success: true, message: 'License deleted successfully' });
};

exports.resetLicenseActivations = async (req, res) => {
  const license = validId(req.params.licenseId) ? await License.findById(req.params.licenseId) : null;
  if (!license) return res.status(404).json({ success: false, message: 'License not found' });
  license.activations = [];
  license.updatedBy = req.user._id;
  license.version = Number(license.version || 0) + 1;
  await license.save();
  res.json({ success: true, message: 'Legacy activations reset', license });
};

exports.removeLicenseActivation = async (req, res) => {
  const license = validId(req.params.licenseId) ? await License.findById(req.params.licenseId) : null;
  if (!license) return res.status(404).json({ success: false, message: 'License not found' });
  license.activations = (license.activations || []).filter((row) => String(row._id) !== req.params.activationId && row.deviceId !== req.params.activationId);
  license.updatedBy = req.user._id;
  await license.save();
  res.json({ success: true, license });
};
