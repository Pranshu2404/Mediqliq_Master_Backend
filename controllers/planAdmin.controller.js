const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const { normalizeEntitlements } = require('../utils/entitlements');

function validId(value) { return mongoose.Types.ObjectId.isValid(value); }

exports.listPlans = async (req, res) => {
  const filter = {};
  if (req.query.active !== undefined) filter.active = req.query.active === 'true';
  const plans = await Plan.find(filter).sort({ internalOnly: 1, name: 1, version: -1 });
  res.json({ success: true, data: plans });
};

exports.createPlan = async (req, res) => {
  try {
    const { code, name, description, version, active, entitlements, limits, internalOnly } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code and name are required' });
    const plan = await Plan.create({
      code,
      name,
      description,
      version: Number(version || 1),
      active: active !== undefined ? Boolean(active) : true,
      internalOnly: Boolean(internalOnly),
      entitlements: normalizeEntitlements(entitlements || {}),
      limits: limits || {},
      createdBy: req.user._id
    });
    req.auditResource = { type: 'Plan', id: String(plan._id) };
    res.status(201).json({ success: true, plan });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    if (!validId(req.params.planId)) return res.status(400).json({ success: false, message: 'Invalid plan id' });
    const plan = await Plan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    ['name', 'description', 'active', 'internalOnly', 'limits'].forEach((key) => {
      if (req.body[key] !== undefined) plan[key] = req.body[key];
    });
    if (req.body.code !== undefined) plan.code = req.body.code;
    if (req.body.version !== undefined) plan.version = Number(req.body.version);
    if (req.body.entitlements !== undefined) plan.entitlements = normalizeEntitlements(req.body.entitlements || {});
    plan.updatedBy = req.user._id;
    await plan.save();
    req.auditResource = { type: 'Plan', id: String(plan._id) };
    res.json({ success: true, plan });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.message });
  }
};

exports.getPlan = async (req, res) => {
  if (!validId(req.params.planId)) return res.status(400).json({ success: false, message: 'Invalid plan id' });
  const plan = await Plan.findById(req.params.planId);
  if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
  res.json({ success: true, plan });
};
