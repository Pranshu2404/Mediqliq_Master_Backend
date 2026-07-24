const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  facilityId: { type: String, required: true, index: true },
  subscriptionRequestId: { type: String, index: true },
  subscriptionId: { type: String, index: true },
  patientReference: String,
  abhaAddress: { type: String, index: true },
  status: { type: String, default: 'REQUESTED', index: true },
  categories: [String],
  hiTypes: [String],
  purpose: mongoose.Schema.Types.Mixed,
  period: { from: Date, to: Date },
  rawReference: mongoose.Schema.Types.Mixed
}, { timestamps: true });
schema.index({ facilityId: 1, subscriptionRequestId: 1 }, { unique: true, sparse: true });
schema.index({ facilityId: 1, subscriptionId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('AbdmSubscription', schema);
