const express = require('express');
const { getRows, updateRowByKey } = require('../services/sheets.service');
const { requireAuth } = require('../utils/auth.util');
const { sendEmail } = require('../services/resend.service');
const { STAGES, CANCELLED, stageIndex } = require('../utils/order-status.util');
const { RETURNS_COL } = require('../utils/returns-schema.util');
const { REVIEWS_COL } = require('../utils/reviews-schema.util');

const router = express.Router();

// Orders sheet columns (0-indexed): 0 Order ID, 1 Date, 2 Payment
// Status, 3 Name, 4 Email, 5 Phone, 6 Items, 7 Total, 8 Fulfillment
// Status, 9 Delivered At, 10 Account Email, 11 Address, 12 Item IDs.
// See backend/README.md for the header row to use.
const COL = { id: 0, date: 1, paymentStatus: 2, name: 3, email: 4, phone: 5, items: 6, total: 7, status: 8, deliveredAt: 9, accountEmail: 10, address: 11, itemIds: 12 };

// A customer-typed cancellation reason is mandatory (see the /:orderId/cancel
// route below) and capped the same way other free-text reason fields on
// this site are (see backend/routes/returns.js).
const CANCEL_REASON_MAX_WORDS = 100;

// "cubes:2;dual:1" -> ['cubes', 'dual'] -- see backend/routes/reviews.js,
// which is the other place this same parsing happens.
function orderProductIds(itemIdsCell) {
  return String(itemIdsCell || '')
    .split(';')
    .map(pair => pair.split(':')[0])
    .filter(Boolean);
}

function rowToSummary(row) {
  return {
    orderId: row[COL.id],
    date: row[COL.date],
    items: row[COL.items],
    total: row[COL.total],
    status: row[COL.status] || null,
    deliveredAt: row[COL.deliveredAt] || null,
    phone: row[COL.phone] || '',
    address: row[COL.address] || '',
    // Orders placed before this column existed come back as [] --
    // orders.html simply won't offer a "Write a Review" button for
    // those, same as it can't offer a return on a guest-checkout order.
    itemIds: orderProductIds(row[COL.itemIds]),
  };
}

/* Every order whose Account Email column matches the logged-in user's
   email. Account Email is set once at checkout time from the signed-in
   session and never edited afterwards -- it's kept separate from the
   customer-facing "Email" (contact) column specifically so that column
   can stay freely editable without breaking this lookup. */
router.get('/mine', requireAuth, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (orders/mine):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load your orders right now.' });
  }

  const email = req.user.email.toLowerCase();
  const orders = rows
    .slice(1) // skip header row
    .filter(row => row[COL.paymentStatus] === 'paid' && (row[COL.accountEmail] || '').toLowerCase() === email)
    .map(rowToSummary)
    .reverse(); // most recent first

  res.json({ ok: true, orders });
});

/* A single order's detail + which stages are complete, for the
   stepper UI. Checks the order actually belongs to the requesting
   user before returning anything — otherwise anyone could read any
   order just by guessing/incrementing an order id. */
router.get('/:orderId', requireAuth, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (orders/:id):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load this order right now.' });
  }

  const row = rows.slice(1).find(r => r[COL.id] === req.params.orderId);
  if (!row || (row[COL.accountEmail] || '').toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }

  // Latest return request (if any) filed against this order, so the
  // customer sees "Waiting for approval" / the decision instead of
  // just being able to file a duplicate request while one is pending.
  let returnStatus = null;
  try {
    const returnRows = await getRows('Returns');
    const matches = returnRows.slice(1).filter(r => r[RETURNS_COL.orderId] === req.params.orderId);
    if (matches.length) returnStatus = matches[matches.length - 1][RETURNS_COL.status] || 'Requested';
  } catch (err) {
    console.error('Sheets read failed (orders/:id return lookup):', err.message);
    // Non-fatal -- the order itself still loads, just without return status.
  }

  // Per-product review status for this order -- 'Pending' / 'Approved'
  // / 'Rejected' if one's already been filed for that product+order,
  // so orders.html shows the right thing instead of offering "Write a
  // Review" for something already reviewed.
  let reviewStatuses = {};
  try {
    const reviewRows = await getRows('Reviews');
    reviewRows.slice(1)
      .filter(r => r[REVIEWS_COL.orderId] === req.params.orderId)
      .forEach(r => { reviewStatuses[r[REVIEWS_COL.productId]] = r[REVIEWS_COL.status] || 'Pending'; });
  } catch (err) {
    console.error('Sheets read failed (orders/:id review lookup):', err.message);
    // Non-fatal -- the order itself still loads, just without review status.
  }

  const currentIndex = stageIndex(row[COL.status]);
  res.json({
    ok: true,
    order: rowToSummary(row),
    stages: STAGES.map((label, i) => ({ label, done: currentIndex >= 0 && i <= currentIndex })),
    returnStatus,
    reviewStatuses,
  });
});

/* Customer-initiated cancellation -- only while the order hasn't
   shipped yet. The client only shows this button pre-shipment, but
   that copy of the status can be a few minutes stale (an admin could
   have marked it Shipped in the meantime), so this re-reads the
   current status from the sheet itself and is the real gate, not the
   button's visibility. From "Shipped" onward this always refuses,
   full stop -- a shipped order is handled through Request a Return
   after it arrives instead. */
router.post('/:orderId/cancel', requireAuth, async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) {
    return res.status(400).json({ ok: false, error: "Please tell us why you're cancelling." });
  }
  if (reason.split(/\s+/).filter(Boolean).length > CANCEL_REASON_MAX_WORDS) {
    return res.status(400).json({ ok: false, error: `Keep the reason to ${CANCEL_REASON_MAX_WORDS} words or fewer.` });
  }

  let rows;
  try {
    rows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (orders/cancel):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not process this right now.' });
  }

  const row = rows.slice(1).find(r => r[COL.id] === req.params.orderId);
  if (!row || (row[COL.accountEmail] || '').toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }

  const status = row[COL.status] || '';
  if (status === CANCELLED) {
    return res.status(409).json({ ok: false, error: 'This order is already cancelled.' });
  }
  if (status === 'Delivered') {
    return res.status(409).json({ ok: false, error: "This order has already been delivered, so it can't be cancelled. You can request a return instead." });
  }
  // stageIndex('') is -1 ("Order Placed", nothing shipped yet); anything
  // from "Shipped" (index 1) onward is too late.
  if (stageIndex(status) >= 1) {
    return res.status(409).json({ ok: false, error: 'This order has already shipped and can no longer be cancelled. You can request a return once it arrives instead.' });
  }

  let updated;
  try {
    // Column N = Cancellation Reason, appended at the end of the Orders
    // sheet (see backend/README.md) -- new columns always go at the end
    // here, never inserted earlier, so every existing row index stays
    // valid.
    updated = await updateRowByKey('Orders', req.params.orderId, { I: CANCELLED, N: reason });
  } catch (err) {
    console.error('Sheets update failed (orders/cancel):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not cancel this order right now.' });
  }
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }

  // Best-effort: confirm the cancellation by email.
  try {
    if (row[COL.email]) {
      await sendEmail({
        to: row[COL.email],
        subject: 'Your Brine & Shell order was cancelled',
        html: `<p>Order <strong>${req.params.orderId}</strong> has been cancelled at your request.</p><p>Reason given: ${reason}</p>`,
      });
    }
  } catch (err) {
    console.error('Email send failed (customer order cancel):', err.message);
  }

  res.json({ ok: true });
});

module.exports = router;
