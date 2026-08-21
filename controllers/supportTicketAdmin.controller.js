const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');

function validId(value) { return mongoose.Types.ObjectId.isValid(value); }
function escapeRegex(value = '') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

exports.listTickets = async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;
  if (req.query.hospitalId && validId(req.query.hospitalId)) filter.hospital = req.query.hospitalId;
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ ticketRef: regex }, { tenantCode: regex }, { subject: regex }, { category: regex }];
  }
  const [data, total] = await Promise.all([
    SupportTicket.find(filter)
      .populate('hospital', 'hospitalName hospitalID tenantCode email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SupportTicket.countDocuments(filter)
  ]);
  res.json({ success: true, data, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 } });
};

exports.getTicket = async (req, res) => {
  if (!validId(req.params.ticketId)) return res.status(400).json({ success: false, message: 'Invalid ticket id' });
  const ticket = await SupportTicket.findById(req.params.ticketId)
    .populate('hospital', 'hospitalName hospitalID tenantCode email contact')
    .populate('assignedTo', 'name email');
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
  res.json({ success: true, ticket });
};

exports.updateTicket = async (req, res) => {
  if (!validId(req.params.ticketId)) return res.status(400).json({ success: false, message: 'Invalid ticket id' });
  const ticket = await SupportTicket.findById(req.params.ticketId);
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
  if (req.body.status !== undefined) ticket.status = req.body.status;
  if (req.body.assignedTo !== undefined) ticket.assignedTo = req.body.assignedTo || undefined;
  if (req.body.internalNote) {
    ticket.internalNotes.push({
      message: String(req.body.internalNote).trim().slice(0, 5000),
      author: { userId: req.user._id, name: req.user.name, email: req.user.email }
    });
  }
  ticket.activity.push({
    type: 'UPDATED',
    message: `Ticket updated${req.body.status ? `; status=${req.body.status}` : ''}`,
    changedBy: { userId: req.user._id, name: req.user.name, email: req.user.email, source: 'MASTER_ADMIN' }
  });
  await ticket.save();
  req.auditResource = { type: 'SupportTicket', id: String(ticket._id) };
  res.json({ success: true, ticket });
};
