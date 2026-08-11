const mongoose = require('mongoose');

const abdmSharedRateLimitBucketSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    tenantCode: { type: String, required: true, index: true },
    facilityId: { type: String, required: true, index: true },
    service: { type: String, required: true, enum: ['FHIR', 'CRYPTO', 'CONSENT', 'HEALTH'], index: true },
    windowStartedAt: { type: Date, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

abdmSharedRateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
abdmSharedRateLimitBucketSchema.index({ tenantCode: 1, service: 1, windowStartedAt: -1 });

module.exports = mongoose.model('AbdmSharedRateLimitBucket', abdmSharedRateLimitBucketSchema);
