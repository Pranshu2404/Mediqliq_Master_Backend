const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true, select: false },
  facilityId: { type: String, required: true, index: true },
  consentId: { type: String, index: true },
  requestReference: { type: String, index: true },
  transactionId: { type: String, index: true },
  status: { type: String, enum: ['ACTIVE','USED','REVOKED','EXPIRED'], default: 'ACTIVE', index: true },
  maxPushes: { type: Number, default: 20, min: 1, max: 1000 },
  pushCount: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('AbdmDataRelayToken', schema);
