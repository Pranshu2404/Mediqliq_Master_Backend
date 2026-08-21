const mongoose = require('mongoose');
const { mergeEntitlements, normalizeEntitlements } = require('../utils/entitlements');

const activationSchema = new mongoose.Schema({
  deviceId: String,
  hospitalName: String,
  activatedAt: { type: Date, default: Date.now },
  lastSeen: Date
});

const licenseSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true, trim: true },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', index: true },

  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', index: true },
  planCode: { type: String, trim: true, uppercase: true, index: true },
  planVersion: { type: Number, default: 1, min: 1 },

  startsAt: Date,
  expiresAt: Date,
  status: {
    type: String,
    enum: ['active', 'blocked', 'expired'],
    default: 'active',
    index: true
  },

  entitlementSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  entitlementOverrides: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  limitsSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  version: { type: Number, default: 1, min: 1, index: true },

  issuedTo: { type: String, trim: true },
  notes: String,
  metadata: mongoose.Schema.Types.Mixed,

  delivery: {
    lastPushAt: Date,
    lastPushStatus: { type: String, enum: ['PENDING', 'DELIVERED', 'FAILED'] },
    lastPushError: String
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Deprecated legacy fields retained for migration/read compatibility.
  plan: { type: String, trim: true },
  expiryDate: Date,
  features: mongoose.Schema.Types.Mixed,
  maxActivations: { type: Number, default: 2, min: 1 },
  activations: [activationSchema]
}, { timestamps: true });

licenseSchema.pre('validate', function normalizeLicense(next) {
  if (!this.planCode && this.plan) this.planCode = String(this.plan).trim().toUpperCase();
  if (!this.plan && this.planCode) this.plan = this.planCode;
  if (!this.expiresAt && this.expiryDate) this.expiresAt = this.expiryDate;
  if (!this.expiryDate && this.expiresAt) this.expiryDate = this.expiresAt;
  if ((!this.entitlementSnapshot || Object.keys(this.entitlementSnapshot).length === 0) && this.features) {
    this.entitlementSnapshot = normalizeEntitlements(this.features);
  }
  this.entitlementSnapshot = normalizeEntitlements(this.entitlementSnapshot || {});
  this.entitlementOverrides = Object.fromEntries(
    Object.entries(this.entitlementOverrides || {}).filter(([, value]) => value !== undefined && value !== null)
  );
  next();
});

licenseSchema.virtual('effectiveEntitlements').get(function effectiveEntitlements() {
  return mergeEntitlements(this.entitlementSnapshot || {}, this.entitlementOverrides || {});
});

licenseSchema.set('toJSON', { virtuals: true });
licenseSchema.set('toObject', { virtuals: true });
licenseSchema.index({ hospital: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('License', licenseSchema);
