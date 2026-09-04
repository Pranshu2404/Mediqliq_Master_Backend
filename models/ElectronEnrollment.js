const mongoose = require('mongoose');

const encryptedValueSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true, select: false },
  iv: { type: String, required: true, select: false },
  tag: { type: String, required: true, select: false }
}, { _id: false });

const schema = new mongoose.Schema({
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  temporaryPasswordEncrypted: { type: encryptedValueSchema, required: true, select: false },
  status: { type: String, enum: ['ISSUED', 'CLAIMED', 'COMPLETED', 'REVOKED', 'EXPIRED'], default: 'ISSUED', index: true },
  expiresAt: { type: Date, required: true, index: true },
  claimedAt: Date,
  completedAt: Date,
  installationId: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('ElectronEnrollment', schema);
