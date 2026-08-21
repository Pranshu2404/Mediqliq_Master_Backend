const mongoose = require('mongoose');

const platformDeliverySchema = new mongoose.Schema({
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
  tenantCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  type: { type: String, enum: ['LICENSE_EVENT'], required: true, index: true },
  path: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'DELIVERED', 'FAILED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  nextRetryAt: { type: Date, default: Date.now, index: true },
  deliveredAt: Date,
  lastAttemptAt: Date,
  lastError: String
}, { timestamps: true });

platformDeliverySchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('PlatformDelivery', platformDeliverySchema);
