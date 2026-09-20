const express = require('express');
const { appendRow } = require('../services/sheets.service');
const { sendEmail } = require('../services/resend.service');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', async (req, res) => {
  const body = req.body || {};
  if (body.company) return res.json({ ok: true }); // honeypot

  const email = String(body.email || '').trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn\'t look right.' });
  }

  try {
    await appendRow('Newsletter', [new Date().toISOString(), email]);
  } catch (err) {
    console.error('Sheets append failed (newsletter):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not save your subscription right now. Please try again shortly.' });
  }

  // Best-effort welcome email — a failure here shouldn't fail the
  // signup, since the address is already saved above.
  try {
    await sendEmail({
      to: email,
      subject: 'Welcome to Brine & Shell: here\'s your 10% code',
      html: `<p>Thanks for subscribing! Use code <strong>WELCOME10</strong> for 10% off your first order.</p>`,
    });
  } catch (err) {
    console.error('Email send failed (newsletter welcome):', err.message);
  }

  res.json({ ok: true });
});

module.exports = router;
