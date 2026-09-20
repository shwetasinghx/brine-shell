const express = require('express');
const { appendRow } = require('../services/sheets.service');
const { sendEmail } = require('../services/resend.service');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, maxLen) {
  return String(str || '').trim().slice(0, maxLen);
}

router.post('/', async (req, res) => {
  const body = req.body || {};

  // Honeypot: a real visitor never fills this hidden field in.
  if (body.company) {
    return res.json({ ok: true }); // pretend success, drop silently
  }

  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 20);
  const subject = clean(body.subject, 100);
  const message = clean(body.message, 3000);

  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ ok: false, error: 'Please fill in all required fields.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn\'t look right.' });
  }

  const submittedAt = new Date().toISOString();

  try {
    await appendRow('Contact', [submittedAt, firstName, lastName, email, phone, subject, message]);
  } catch (err) {
    console.error('Sheets append failed (contact):', err.message);
    // Don't fail the whole request just because the sheet is
    // unreachable — the email below is the primary delivery path.
  }

  try {
    await sendEmail({
      to: process.env.CONTACT_TO_EMAIL,
      replyTo: email,
      subject: `New contact form message: ${subject}`,
      html: `
        <p><strong>From:</strong> ${firstName} ${lastName} (${email}${phone ? ', ' + phone : ''})</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });
  } catch (err) {
    console.error('Email send failed (contact):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not send your message right now. Please try again shortly or email us directly.' });
  }

  res.json({ ok: true });
});

module.exports = router;
