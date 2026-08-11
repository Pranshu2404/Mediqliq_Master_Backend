const mongoose = require('mongoose');

const abdmConsentUsageReservationSchema = new mongoose.Schema(
  {
    reservationHash: { type: String, required: true, unique: true, index: true },
    tenantCode: { type: String, required: true, index: true },
    facilityId: { type: String, required: true, index: true },
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', index: true, sparse: true },
    validationId: { type: String, index: true, sparse: true },
    status: {
      type: String,
      enum: ['RESERVED', 'COMMITTING', 'COMMITTED', 'RELEASING', 'RELEASED'],
      default: 'RESERVED',
      index: true
    },
    decisionExpiresAt: Date,
    expiresAt: { type: Date, required: true, index: true },
    lastActionAt: Date
  },
  { timestamps: true }
);

abdmConsentUsageReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
abdmConsentUsageReservationSchema.index({ tenantCode: 1, facilityId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AbdmConsentUsageReservation', abdmConsentUsageReservationSchema);
