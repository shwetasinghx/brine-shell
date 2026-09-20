const express = require('express');
const crypto = require('crypto');
const { getRows, appendRow, updateRowByKey } = require('../services/sheets.service');
const { requireAuth } = require('../utils/auth.util');

const router = express.Router();

// Addresses sheet columns: Address ID | Account Email | Label |
// Recipient Name | Phone | Address | Status | Created At | Pincode |
// City | State. One row per saved address -- an account can have
// several (Home, Office, a gift recipient's place, etc). "Status" is
// soft-delete ('Active' / 'Deleted') so removing one doesn't require
// deleting a row out of the sheet via the Sheets API, only flipping a
// column. Pincode/City/State are appended as the last columns (rather
// than inserted next to Address) so they line up with an existing
// sheet by just adding more columns at the end, matching how Orders
// picked up its Account Email / Address columns. "Address" itself is
// deliberately just the street line -- City/State/Pincode are their
// own mandatory fields so the address book can't turn into an
// unreadable wall of text.
const COL = { id: 0, accountEmail: 1, label: 2, recipientName: 3, phone: 4, address: 5, status: 6, createdAt: 7, pincode: 8, city: 9, state: 10 };

function rowToAddress(row) {
  return {
    id: row[COL.id],
    label: row[COL.label] || '',
    recipientName: row[COL.recipientName] || '',
    phone: row[COL.phone] || '',
    address: row[COL.address] || '',
    pincode: row[COL.pincode] || '',
    city: row[COL.city] || '',
    state: row[COL.state] || '',
  };
}

router.get('/', requireAuth, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Addresses');
  } catch (err) {
    console.error('Sheets read failed (addresses):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load your saved addresses right now.' });
  }

  const email = req.user.email.toLowerCase();
  const addresses = rows
    .slice(1)
    .filter(r => (r[COL.accountEmail] || '').toLowerCase() === email && r[COL.status] !== 'Deleted')
    .map(rowToAddress);

  res.json({ ok: true, addresses });
});

router.post('/', requireAuth, async (req, res) => {
  // Address is deliberately capped short (the street line only --
  // house/flat no., building, street, area). City, State and Pincode
  // are their own mandatory fields rather than more free text to
  // paste into one giant box.
  const label = String(req.body?.label || '').trim().slice(0, 60);
  const recipientName = String(req.body?.recipientName || '').trim().slice(0, 120);
  const phone = String(req.body?.phone || '').trim().slice(0, 20);
  const address = String(req.body?.address || '').trim().slice(0, 160);
  const city = String(req.body?.city || '').trim().slice(0, 60);
  const state = String(req.body?.state || '').trim().slice(0, 60);
  const pincode = String(req.body?.pincode || '').trim().slice(0, 6);

  if (!label || !recipientName || !address || !city || !state) {
    return res.status(400).json({ ok: false, error: 'Please fill in a label, recipient name, address, city, and state.' });
  }
  if (!phone || phone.replace(/\D/g, '').length !== 10) {
    return res.status(400).json({ ok: false, error: 'Enter a valid 10-digit phone number for this address.' });
  }
  if (address.length < 5) {
    return res.status(400).json({ ok: false, error: 'Please enter the street address.' });
  }
  if (address.split(/\s+/).filter(Boolean).length > 25) {
    return res.status(400).json({ ok: false, error: 'Keep the address to 25 words or fewer -- City/State/PIN have their own fields.' });
  }
  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid 6-digit PIN code.' });
  }

  const id = `addr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  try {
    await appendRow('Addresses', [
      id,
      req.user.email.toLowerCase(),
      label,
      recipientName,
      phone,
      address,
      'Active',
      new Date().toISOString(),
      pincode,
      city,
      state,
    ]);
  } catch (err) {
    console.error('Sheets append failed (addresses):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not save that address right now.' });
  }

  res.json({ ok: true, address: { id, label, recipientName, phone, address, pincode, city, state } });
});

/* Soft-delete: verifies the address actually belongs to the
   requesting account before flipping its Status, so one signed-in
   customer can't remove another's saved address by guessing an id. */
router.delete('/:addressId', requireAuth, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Addresses');
  } catch (err) {
    console.error('Sheets read failed (addresses delete):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not remove that address right now.' });
  }

  const email = req.user.email.toLowerCase();
  const row = rows.slice(1).find(r => r[COL.id] === req.params.addressId);
  if (!row || (row[COL.accountEmail] || '').toLowerCase() !== email) {
    return res.status(404).json({ ok: false, error: 'Address not found.' });
  }

  try {
    await updateRowByKey('Addresses', req.params.addressId, { G: 'Deleted' });
  } catch (err) {
    console.error('Sheets update failed (addresses delete):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not remove that address right now.' });
  }

  res.json({ ok: true });
});

module.exports = router;
