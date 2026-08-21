const mongoose = require('mongoose');

const platformRequestSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, index: true },
  direction: { type: String, enum: ['MASTER_INBOUND', 'HOSPITAL_INBOUND'], required: true },
  identity: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

module.exports = mongoose.model('PlatformRequest', platformRequestSchema);
