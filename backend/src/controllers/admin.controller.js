const express = require('express');
const {
  ADMIN_COOKIE_NAME, checkAdminPassword, signAdminSession, adminCookieOptions, requireAdmin,
} = require('../utils/auth.util');
const { getRows, updateRowByKey, updateRowByColumn } = require('../services/sheets.service');
const { sendEmail } = require('../services/resend.service');
const { STAGES, ALL_STATUSES } = require('../utils/order-status.util');
const { RETURNS_COL: RCOL, RETURN_STATUSES } = require('../utils/returns-schema.util');
const { REVIEWS_COL, REVIEW_STATUSES } = require('../utils/reviews-schema.util');
const { getProduct } = require('../utils/catalog.util');

const router = express.Router();
const COL = { id: 0, date: 1, paymentStatus: 2, name: 3, email: 4, phone: 5, items: 6, total: 7, status: 8, deliveredAt: 9, accountEmail: 10, address: 11, cancelReason: 13 };

// Returns sheet columns: Timestamp | Order ID | Customer Email |
// Items | Reason | Status | Image URL | Return ID | Video URL.
// Return ID and Video URL were both appended after the fact (same as
// Addresses' Pincode/City/State) so an existing sheet doesn't need
// every other column reshuffled -- a request from before these
// existed just won't have them, and can't be individually approved/
// cancelled here (there's nothing reliable to match it by). Status
// starts out "Requested" and is moved to "Approved" or "Cancelled"
// from here -- e.g. cancelling a request that turns out to have bad/
// insufficient info attached, or approving a legitimate one.

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!checkAdminPassword(password)) {
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
  res.cookie(ADMIN_COOKIE_NAME, signAdminSession(), adminCookieOptions());
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, adminCookieOptions());
  res.json({ ok: true });
});

/* Every paid order, for the admin table — unlike /api/orders/mine,
   this isn't filtered to one customer. */
router.get('/orders', requireAdmin, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (admin/orders):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load orders right now.' });
  }

  const orders = rows.slice(1)
    .filter(r => r[COL.paymentStatus] === 'paid')
    .map(r => ({
      orderId: r[COL.id],
      date: r[COL.date],
      name: r[COL.name],
      email: r[COL.email],
      phone: r[COL.phone],
      items: r[COL.items],
      total: r[COL.total],
      status: r[COL.status] || 'Order Placed',
      address: r[COL.address] || '',
      accountEmail: r[COL.accountEmail] || '',
      // Only ever set when the customer cancelled it themselves from
      // /orders.html (that flow requires a reason). Blank means either
      // this order isn't cancelled, or it was cancelled by an admin
      // instead (whose reason, if any, went straight into the
      // customer's email rather than into this column) -- see
      // backend/README.md.
      cancelReason: r[COL.cancelReason] || '',
    }))
    .reverse();

  res.json({ ok: true, orders, stages: STAGES, statuses: ALL_STATUSES });
});

router.post('/orders/:orderId/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  // Optional, only meaningful for a Cancelled order -- an admin-typed
  // reason (e.g. "delivery location is outside our service area")
  // dropped straight into the customer's notification email.
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, error: `Status must be one of: ${ALL_STATUSES.join(', ')}` });
  }

  // Stamp the exact date/time only when the order actually reaches
  // "Delivered" — that's the timestamp customers see on their order.
  const updates = { I: status };
  if (status === 'Delivered') {
    updates.J = new Date().toISOString();
  }

  let updated;
  try {
    updated = await updateRowByKey('Orders', req.params.orderId, updates);
  } catch (err) {
    console.error('Sheets update failed (admin status):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not update that order right now.' });
  }
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }

  // Best-effort: let the customer know their order moved forward.
  try {
    const rows = await getRows('Orders');
    const row = rows.slice(1).find(r => r[COL.id] === req.params.orderId);
    if (row?.[COL.email]) {
      await sendEmail({
        to: row[COL.email],
        subject: `Your Brine & Shell order is now: ${status}`,
        html: `<p>Order <strong>${req.params.orderId}</strong> status update: <strong>${status}</strong>.</p>${note ? `<p>${note}</p>` : ''}`,
      });
    }
  } catch (err) {
    console.error('Email send failed (status update):', err.message);
  }

  res.json({ ok: true });
});

/* Every return request, newest first, for the admin table. */
router.get('/returns', requireAdmin, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Returns');
  } catch (err) {
    console.error('Sheets read failed (admin/returns):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load return requests right now.' });
  }

  const returns = rows.slice(1)
    .map(r => ({
      id: r[RCOL.id] || '',
      timestamp: r[RCOL.timestamp],
      orderId: r[RCOL.orderId],
      email: r[RCOL.email],
      items: r[RCOL.items],
      reason: r[RCOL.reason],
      status: r[RCOL.status] || 'Requested',
      imageUrl: r[RCOL.imageUrl] || '',
      videoUrl: r[RCOL.videoUrl] || '',
      challenge: r[RCOL.challenge] || '',
    }))
    .reverse();

  res.json({ ok: true, returns, statuses: RETURN_STATUSES });
});

/* Approve or cancel a return request. Cancelling is for requests that
   turn out to have bad/insufficient info (wrong order, unusable
   photo, etc) rather than a legitimate issue -- it's a decision, not
   a delete, so the request and its photo stay on record either way. */
router.post('/returns/:returnId/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!RETURN_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, error: `Status must be one of: ${RETURN_STATUSES.join(', ')}` });
  }

  let updated;
  try {
    // Match on the Return ID column (index 7 = H), update Status (F).
    updated = await updateRowByColumn('Returns', RCOL.id, req.params.returnId, { F: status });
  } catch (err) {
    console.error('Sheets update failed (admin return status):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not update that return request right now.' });
  }
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Return request not found (an older request filed before this feature existed can\'t be managed here).' });
  }

  // Best-effort: let the customer know the decision on their request.
  try {
    const rows = await getRows('Returns');
    const row = rows.slice(1).find(r => r[RCOL.id] === req.params.returnId);
    if (row?.[RCOL.email]) {
      await sendEmail({
        to: row[RCOL.email],
        subject: `Update on your return request for order ${row[RCOL.orderId]}`,
        html: `<p>Your return request for order <strong>${row[RCOL.orderId]}</strong> has been <strong>${status.toLowerCase()}</strong>.</p>`,
      });
    }
  } catch (err) {
    console.error('Email send failed (return status update):', err.message);
  }

  res.json({ ok: true });
});

/* Every product review, newest first, for moderation. Nothing here is
   shown publicly (see /api/reviews on the customer side) until it's
   Approved -- a small brand's only public trust signal is worth the
   extra step of a human reading it first. */
router.get('/reviews', requireAdmin, async (req, res) => {
  let rows;
  try {
    rows = await getRows('Reviews');
  } catch (err) {
    console.error('Sheets read failed (admin/reviews):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load reviews right now.' });
  }

  const reviews = rows.slice(1)
    .map(r => ({
      id: r[REVIEWS_COL.id] || '',
      timestamp: r[REVIEWS_COL.timestamp],
      orderId: r[REVIEWS_COL.orderId],
      productId: r[REVIEWS_COL.productId],
      productName: getProduct(r[REVIEWS_COL.productId])?.name || r[REVIEWS_COL.productId],
      email: r[REVIEWS_COL.email],
      name: r[REVIEWS_COL.name],
      productRating: Number(r[REVIEWS_COL.productRating]) || 0,
      deliverySpeed: r[REVIEWS_COL.deliverySpeed] || '',
      text: r[REVIEWS_COL.text] || '',
      status: r[REVIEWS_COL.status] || 'Pending',
    }))
    .reverse();

  res.json({ ok: true, reviews, statuses: REVIEW_STATUSES });
});

/* Approve or reject a review. Rejecting is for spam/abuse/obviously
   fake reviews -- it stays on record either way, just never shown on
   the shop page unless Approved. */
router.post('/reviews/:reviewId/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  // notify defaults to FALSE: like Flipkart/Amazon-style moderation,
  // reviews are approved or rejected silently by default -- moderation
  // here exists to keep vulgar/abusive/spam content off a personal brand
  // site, not to run an email loop with every reviewer. The admin can
  // still tick "Notify customer" per-row for the rare case they want to
  // reach out (e.g. a mistaken rejection worth explaining).
  const notify = req.body?.notify === true;
  if (!REVIEW_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, error: `Status must be one of: ${REVIEW_STATUSES.join(', ')}` });
  }

  let updated;
  try {
    // Match on the Review ID column (index 9 = J), update Status (I).
    updated = await updateRowByColumn('Reviews', REVIEWS_COL.id, req.params.reviewId, { I: status });
  } catch (err) {
    console.error('Sheets update failed (admin review status):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not update that review right now.' });
  }
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Review not found.' });
  }

  // Best-effort: let the customer know their review is live (or wasn't
  // approved) -- unless the admin explicitly opted out of notifying them.
  try {
    const rows = await getRows('Reviews');
    const row = rows.slice(1).find(r => r[REVIEWS_COL.id] === req.params.reviewId);
    if (notify && row?.[REVIEWS_COL.email]) {
      const productName = getProduct(row[REVIEWS_COL.productId])?.name || row[REVIEWS_COL.productId];
      await sendEmail({
        to: row[REVIEWS_COL.email],
        subject: `Your review of ${productName}`,
        html: status === 'Approved'
          ? `<p>Thanks! Your review of <strong>${productName}</strong> is now live on our site.</p>`
          : `<p>Your review of <strong>${productName}</strong> wasn't approved for publishing. Contact us if you think this is a mistake.</p>`,
      });
    }
  } catch (err) {
    console.error('Email send failed (review status update):', err.message);
  }

  res.json({ ok: true });
});

module.exports = router;
