const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  type: { type: String, trim: true },
  message: { type: String, trim: true },
  changedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String,
    source: String
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const noteSchema = new mongoose.Schema({
  message: { type: String, required: true, trim: true },
  author: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
  ticketRef: { type: String, required: true, unique: true, index: true, trim: true, uppercase: true },
  requestId: { type: String, unique: true, sparse: true, index: true },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
  tenantCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  submittedBy: {
    userId: String,
    name: String,
    email: String,
    phone: String
  },
  category: { type: String, default: 'General', trim: true },
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL', index: true },
  subject: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_HOSPITAL', 'RESOLVED', 'CLOSED'],
    default: 'OPEN',
    index: true
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  internalNotes: { type: [noteSchema], default: [] },
  activity: { type: [activitySchema], default: [] },
  notification: {
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'], default: 'PENDING' },
    sentAt: Date,
    lastError: String
  }
}, { timestamps: true });

supportTicketSchema.index({ tenantCode: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
