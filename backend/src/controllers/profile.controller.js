const express = require('express');
const { getRows, upsertRow } = require('../services/sheets.service');
const { requireAuth } = require('../utils/auth.util');

const router = express.Router();

// Profiles sheet columns: Account Email | Name | Phone | Updated At.
// This holds the account holder's OWN name/phone -- who placed the
// order and gets the confirmation email. Delivery locations (which
// can belong to someone else entirely, e.g. a gift) live separately
// in the Addresses tab / routes/addresses.js.
const COL = { email: 0, name: 1, phone: 2, updatedAt: 3 };

router.get('/', requireAuth, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Profiles');
  } catch (err) {
    console.error('Sheets read failed (profile):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load your profile right now.' });
  }

  const email = req.user.email.toLowerCase();
  const row = rows.slice(1).find(r => (r[COL.email] || '').toLowerCase() === email);

  res.json({
    ok: true,
    profile: {
      name: row?.[COL.name] || req.user.name || '',
      phone: row?.[COL.phone] || '',
    },
  });
});

/* Name and phone are both required here -- this is the account's core
   contact info (used to prefill checkout and shown in the admin's
   customer column), not an optional nicety. */
router.post('/', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const phone = String(req.body?.phone || '').trim().slice(0, 20);

  if (!name) {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (!phone || phone.replace(/\D/g, '').length !== 10) {
    return res.status(400).json({ ok: false, error: 'Enter a valid 10-digit phone number.' });
  }

  const email = req.user.email.toLowerCase();
  try {
    await upsertRow('Profiles', email, [email, name, phone, new Date().toISOString()]);
  } catch (err) {
    console.error('Sheets upsert failed (profile):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not save your profile right now.' });
  }

  res.json({ ok: true });
});

module.exports = router;
