/* =========================================
   Transactional email via the Hostinger
   business-email mailbox's own SMTP server --
   no third-party provider, no domain
   verification step. If the mailbox can send
   from Hostinger Webmail, it can send from
   here with the same address and password.
   ========================================= */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP_USER / SMTP_PASS are not set in .env');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for port 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
  });
  return transporter;
}

async function sendEmail({ to, subject, html, replyTo }) {
  const t = getTransporter();
  const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || 'Brine & Shell';
  return t.sendMail({
    from: `${fromName} <${fromAddress}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
}

module.exports = { sendEmail };
