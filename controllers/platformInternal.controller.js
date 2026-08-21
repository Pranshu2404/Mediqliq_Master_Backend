const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { currentLicenseForHospital, buildLicensePayload } = require('../services/licenseControl.service');

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function priority(value) {
  const normalized = clean(value, 20).toUpperCase();
  return ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(normalized) ? normalized : 'NORMAL';
}

async function nextTicketRef(tenantCode) {
  const prefix = String(tenantCode || 'HOSP').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10) || 'HOSP';
  const count = await SupportTicket.countDocuments({ tenantCode: String(tenantCode).toUpperCase() });
  for (let offset = 1; offset < 100; offset += 1) {
    const ref = `MQ-${prefix}-${String(count + offset).padStart(6, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await SupportTicket.exists({ ticketRef: ref }))) return ref;
  }
  return `MQ-${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

exports.health = async (req, res) => {
  res.json({ success: true, tenantCode: req.platformHospital.tenantCode, status: 'ok', timestamp: new Date().toISOString() });
};

exports.validateLicense = async (req, res) => {
  const license = await currentLicenseForHospital(req.platformHospital._id);
  if (!license) return res.status(404).json({ success: false, code: 'LICENSE_NOT_FOUND', error: 'No license is mapped to this hospital' });
  return res.json({ success: true, license: buildLicensePayload(license) });
};

exports.submitSupportTicket = async (req, res) => {
  try {
    const requestId = clean(req.body.ticketRequestId || req.platformRequestId, 120);
    if (requestId) {
      const existing = await SupportTicket.findOne({ requestId });
      if (existing) return res.status(200).json({ success: true, ticketRef: existing.ticketRef, status: existing.status, idempotent: true });
    }

    const subject = clean(req.body.subject, 180);
    const message = clean(req.body.message, 8000);
    if (!subject || !message) return res.status(400).json({ success: false, error: 'subject and message are required' });

    const ticketRef = await nextTicketRef(req.platformHospital.tenantCode);
    const ticket = await SupportTicket.create({
      ticketRef,
      requestId: requestId || undefined,
      hospital: req.platformHospital._id,
      tenantCode: req.platformHospital.tenantCode,
      submittedBy: {
        userId: clean(req.body.submittedBy?.userId, 120),
        name: clean(req.body.submittedBy?.name, 160),
        email: clean(req.body.submittedBy?.email, 200),
        phone: clean(req.body.submittedBy?.phone, 40)
      },
      category: clean(req.body.category, 80) || 'General',
      priority: priority(req.body.priority),
      subject,
      message,
      activity: [{ type: 'CREATED', message: 'Ticket created from hospital HIMS', changedBy: { source: 'HOSPITAL' } }]
    });

    const supportEmail = process.env.MEDIQLIQ_SUPPORT_EMAIL || process.env.RECIPIENT_EMAIL;
    if (!supportEmail) {
      ticket.notification.status = 'SKIPPED';
      ticket.notification.lastError = 'MEDIQLIQ_SUPPORT_EMAIL is not configured';
    } else {
      try {
        await sendEmail({
          to: supportEmail,
          subject: `[${ticket.priority}] ${ticket.ticketRef} - ${ticket.subject}`,
          text: [
            `MediQliq Support Ticket: ${ticket.ticketRef}`,
            `Hospital: ${req.platformHospital.hospitalName}`,
            `Tenant: ${req.platformHospital.tenantCode}`,
            `Submitted by: ${ticket.submittedBy?.name || 'Hospital user'} (${ticket.submittedBy?.email || 'No email'})`,
            `Contact: ${ticket.submittedBy?.phone || 'Not provided'}`,
            `Category: ${ticket.category}`,
            `Priority: ${ticket.priority}`,
            `Subject: ${ticket.subject}`,
            '',
            ticket.message
          ].join('\n')
        });
        ticket.notification.status = 'SENT';
        ticket.notification.sentAt = new Date();
      } catch (error) {
        ticket.notification.status = 'FAILED';
        ticket.notification.lastError = error.message;
      }
    }
    await ticket.save();
    return res.status(201).json({ success: true, ticketRef: ticket.ticketRef, status: ticket.status });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
