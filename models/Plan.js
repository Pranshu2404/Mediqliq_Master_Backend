const mongoose = require('mongoose');
const { normalizeEntitlements } = require('../utils/entitlements');

const planSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  version: { type: Number, default: 1, min: 1 },
  active: { type: Boolean, default: true, index: true },
  internalOnly: { type: Boolean, default: false },
  entitlements: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  limits: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

planSchema.pre('validate', function normalizePlan(next) {
  this.code = String(this.code || '').trim().toUpperCase();
  this.entitlements = normalizeEntitlements(this.entitlements || {});
  next();
});

planSchema.index({ code: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('Plan', planSchema);
