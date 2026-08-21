const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass }
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    const error = new Error('SMTP is not configured on MediQliq Master');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }
  return mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
}

module.exports = sendEmail;
