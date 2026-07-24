const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  facilityId: { type: String, required: true, index: true },
  requestId: { type: String, required: true, index: true },
  transactionId: { type: String, index: true },
  consentId: { type: String, index: true },
  status: { type: String, enum: ['INITIATED','ACKNOWLEDGED','DATA_RECEIVED','FORWARDED','COMPLETED','FAILED','EXPIRED'], default: 'INITIATED', index: true },
  hiTypes: [String],
  dateRange: { from: Date, to: Date },
  dataPushUrlHash: String,
  correlation: mongoose.Schema.Types.Mixed,
  error: mongoose.Schema.Types.Mixed,
  expiresAt: Date
}, { timestamps: true });
schema.index({ facilityId: 1, requestId: 1 }, { unique: true });
module.exports = mongoose.model('AbdmHiuRequest', schema);
