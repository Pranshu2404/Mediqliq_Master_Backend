const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  consentId: { type: String, required: true, index: true },
  consentRequestId: { type: String, index: true },
  artefactId: { type: String, index: true },
  facilityId: { type: String, required: true, index: true },
  role: { type: String, enum: ['HIP','HIU'], default: 'HIP', index: true },
  patientReference: { type: String, index: true },
  abhaAddress: { type: String, index: true },
  status: { type: String, enum: ['REQUESTED','PENDING','GRANTED','DENIED','REVOKED','EXPIRED'], required: true, index: true },
  hiTypes: [String],
  purpose: mongoose.Schema.Types.Mixed,
  dateRange: { from: Date, to: Date },
  careContextReferences: [String],
  permission: mongoose.Schema.Types.Mixed,
  signatureVerified: { type: Boolean, default: false },
  rawReference: mongoose.Schema.Types.Mixed,
  expiresAt: Date
}, { timestamps: true });
schema.index({ facilityId: 1, consentId: 1 }, { unique: true });
schema.index({ facilityId: 1, consentRequestId: 1 }, { sparse: true });
module.exports = mongoose.model('AbdmConsent', schema);
