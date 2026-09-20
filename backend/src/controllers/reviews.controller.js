const express = require('express');
const { getRows, appendRow } = require('../services/sheets.service');
const { requireAuth } = require('../utils/auth.util');
const { sendEmail } = require('../services/resend.service');
const { getProduct } = require('../utils/catalog.util');
const { REVIEWS_COL, REVIEW_STATUSES, DELIVERY_SPEEDS, REVIEW_TEXT_MAX_WORDS } = require('../utils/reviews-schema.util');
const { RETURNS_COL } = require('../utils/returns-schema.util');

const router = express.Router();

// Orders sheet columns this route needs (see backend/README.md).
const OCOL = { id: 0, status: 8, accountEmail: 10, itemIds: 12 };

// "cubes:2;dual:1" -> ['cubes', 'dual'] -- the product ids actually
// purchased in an order, so a review can only be filed for something
// that order really contained. Orders placed before this column
// existed are simply not reviewable (same as guest-checkout orders
// predating requireAuth) -- there's nothing reliable to check against.
function orderProductIds(itemIdsCell) {
  return String(itemIdsCell || '')
    .split(';')
    .map(pair => pair.split(':')[0])
    .filter(Boolean);
}

function firstNameLastInitial(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return 'A customer';
  const last = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : '';
  return `${parts[0]}${last}`;
}

function summarize(rows, productId) {
  const approved = rows.slice(1).filter(r => r[REVIEWS_COL.productId] === productId && r[REVIEWS_COL.status] === 'Approved');
  const count = approved.length;
  const avg = count ? approved.reduce((s, r) => s + Number(r[REVIEWS_COL.productRating] || 0), 0) / count : 0;
  const delivery = { Fast: 0, 'On Time': 0, Late: 0 };
  approved.forEach(r => { const s = r[REVIEWS_COL.deliverySpeed]; if (delivery[s] !== undefined) delivery[s]++; });
  return { productId, count, avgRating: count ? Math.round(avg * 10) / 10 : null, delivery };
}

/* Submitting a review requires: signed in, the order is really theirs
   (Account Email match -- same pattern as returns/addresses), the
   order actually reached "Delivered", the product was actually in
   that order, and no earlier review already exists for this exact
   order+product pair (one honest review per purchase, not one per
   star rating attempt). */
router.post('/', requireAuth, async (req, res) => {
  const orderId = String(req.body?.orderId || '').trim();
  const productId = String(req.body?.productId || '').trim();
  const productRating = Number(req.body?.productRating);
  const deliverySpeed = String(req.body?.deliverySpeed || '').trim();
  const text = String(req.body?.text || '').trim().slice(0, 1000);

  if (!orderId || !productId) {
    return res.status(400).json({ ok: false, error: 'Missing order or product.' });
  }
  if (!Number.isInteger(productRating) || productRating < 1 || productRating > 5) {
    return res.status(400).json({ ok: false, error: 'Please give the product a star rating from 1 to 5.' });
  }
  if (!DELIVERY_SPEEDS.includes(deliverySpeed)) {
    return res.status(400).json({ ok: false, error: `Please say how the delivery was: ${DELIVERY_SPEEDS.join(', ')}.` });
  }
  if (text.split(/\s+/).filter(Boolean).length > REVIEW_TEXT_MAX_WORDS) {
    return res.status(400).json({ ok: false, error: `Keep the review to ${REVIEW_TEXT_MAX_WORDS} words or fewer.` });
  }
  if (!getProduct(productId)) {
    return res.status(400).json({ ok: false, error: 'Unknown product.' });
  }

  let orderRows;
  try {
    orderRows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (reviews, orders):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not look up that order right now.' });
  }
  const order = orderRows.slice(1).find(r => r[OCOL.id] === orderId);
  if (!order || (order[OCOL.accountEmail] || '').toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }
  if (order[OCOL.status] !== 'Delivered') {
    return res.status(400).json({ ok: false, error: 'You can review a product once your order has been delivered.' });
  }
  if (!orderProductIds(order[OCOL.itemIds]).includes(productId)) {
    return res.status(400).json({ ok: false, error: "That product wasn't part of this order." });
  }

  // An approved return means the product went back -- there's nothing
  // left to review. A merely-requested (still pending) return doesn't
  // block this; only an approved one does.
  try {
    const returnRows = await getRows('Returns');
    const approvedReturn = returnRows.slice(1)
      .some(r => r[RETURNS_COL.orderId] === orderId && r[RETURNS_COL.status] === 'Approved');
    if (approvedReturn) {
      return res.status(400).json({ ok: false, error: 'This order was returned, so it can\'t be reviewed.' });
    }
  } catch (err) {
    console.error('Sheets read failed (reviews, return check):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not check this order right now.' });
  }

  let reviewRows;
  try {
    reviewRows = await getRows('Reviews');
  } catch (err) {
    console.error('Sheets read failed (reviews, dup-check):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not check existing reviews right now.' });
  }
  const alreadyReviewed = reviewRows.slice(1).some(r => r[REVIEWS_COL.orderId] === orderId && r[REVIEWS_COL.productId] === productId);
  if (alreadyReviewed) {
    return res.status(409).json({ ok: false, error: 'You already reviewed this product for this order.' });
  }

  const reviewId = `rev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    // Reviews sheet header: Timestamp | Order ID | Product ID | Customer Email | Customer Name | Product Rating | Delivery Speed | Review Text | Status | Review ID
    await appendRow('Reviews', [
      new Date().toISOString(),
      orderId,
      productId,
      req.user.email,
      req.user.name || '',
      productRating,
      deliverySpeed,
      text,
      'Pending',
      reviewId,
    ]);
  } catch (err) {
    console.error('Sheets append failed (reviews):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not submit your review right now.' });
  }

  try {
    await sendEmail({
      to: process.env.CONTACT_TO_EMAIL,
      replyTo: req.user.email,
      subject: `New review awaiting approval: ${getProduct(productId)?.name || productId}`,
      html: `
        <p><strong>Product:</strong> ${getProduct(productId)?.name || productId}</p>
        <p><strong>Order:</strong> ${orderId}</p>
        <p><strong>Customer:</strong> ${req.user.name} (${req.user.email})</p>
        <p><strong>Rating:</strong> ${productRating}/5</p>
        <p><strong>Delivery:</strong> ${deliverySpeed}</p>
        <p><strong>Review:</strong> ${text || '(no written review)'}</p>
        <p>Approve or reject it from the admin dashboard.</p>
      `,
    });
  } catch (err) {
    console.error('Email send failed (reviews):', err.message);
    // Not fatal -- the review is already logged and pending in the sheet.
  }

  res.json({ ok: true });
});

/* Public: approved-only rating summary for every product at once, so
   shop.html can show a star rating under each product card with a
   single request instead of one per product. */
router.get('/summary', async (req, res) => {
  let rows;
  try {
    rows = await getRows('Reviews');
  } catch (err) {
    console.error('Sheets read failed (reviews summary):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load reviews right now.' });
  }
  const productIds = [...new Set(rows.slice(1).map(r => r[REVIEWS_COL.productId]).filter(Boolean))];
  const summaries = {};
  productIds.forEach(id => { summaries[id] = summarize(rows, id); });
  res.json({ ok: true, summaries });
});

/* Public: a single product's approved reviews + its summary, for the
   "Read Reviews" modal on shop.html. Reviewer name is trimmed down to
   first name + last initial -- enough to feel like a real person left
   it, not enough to publish someone's full name/email. */
router.get('/product/:productId', async (req, res) => {
  let rows;
  try {
    rows = await getRows('Reviews');
  } catch (err) {
    console.error('Sheets read failed (reviews product):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not load reviews right now.' });
  }
  const productId = req.params.productId;
  const approved = rows.slice(1)
    .filter(r => r[REVIEWS_COL.productId] === productId && r[REVIEWS_COL.status] === 'Approved')
    .map(r => ({
      name: firstNameLastInitial(r[REVIEWS_COL.name]),
      productRating: Number(r[REVIEWS_COL.productRating]) || 0,
      deliverySpeed: r[REVIEWS_COL.deliverySpeed] || '',
      text: r[REVIEWS_COL.text] || '',
      date: r[REVIEWS_COL.timestamp],
    }))
    .reverse();
  res.json({ ok: true, reviews: approved, summary: summarize(rows, productId) });
});

module.exports = router;
