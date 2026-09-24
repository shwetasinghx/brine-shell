const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { decryptBuffer, decryptText } = require('../utils/crypto.util');
const { RETURNS_UPLOAD_DIR, EXT_TO_MIME } = require('../utils/return-media-types.util');
const {
  ADMIN_COOKIE_NAME, checkAdminPassword, signAdminSession, adminCookieOptions, requireAdmin,
} = require('../utils/auth.util');
const { checkLocked, recordFailure, recordSuccess } = require('../utils/admin-lockout.util');
const { getRows, updateRowByKey, updateRowByColumn } = require('../services/sheets.service');
const { sendEmail } = require('../services/mailer.service');
const { STAGES, ALL_STATUSES } = require('../utils/order-status.util');
const { renderOrderStatusEmail } = require('../utils/email-template.util');
const { RETURNS_COL: RCOL, RETURN_STATUSES } = require('../utils/returns-schema.util');
const { REVIEWS_COL, REVIEW_STATUSES } = require('../utils/reviews-schema.util');
const { getProduct } = require('../utils/catalog.util');
const {
  listProducts, addProduct, updateProduct, deleteProduct, deleteProductImage, IMAGES_DIR, VALID_BADGES,
} = require('../utils/products.util');
const {
  listCoupons, validateCouponFields, addCoupon, updateCoupon, deleteCoupon,
} = require('../utils/coupons.util');

const router = express.Router();
const COL = { id: 0, date: 1, paymentStatus: 2, name: 3, email: 4, phone: 5, items: 6, total: 7, status: 8, deliveredAt: 9, accountEmail: 10, address: 11, cancelReason: 13, couponCode: 14, discount: 15 };

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

router.post('/login', async (req, res) => {
  // req.ip relies on 'trust proxy' being set correctly in app.js so
  // this is the real client IP behind Hostinger's reverse proxy, not
  // the proxy's own address for every visitor.
  const ip = req.ip;
  const lock = checkLocked(ip);
  if (lock.locked) {
    return res.status(429).json({
      ok: false,
      error: `Too many attempts. Try again in ${lock.retryAfterSeconds}s.`,
      retryAfterSeconds: lock.retryAfterSeconds,
    });
  }

  const { password } = req.body || {};
  if (!(await checkAdminPassword(password))) {
    recordFailure(ip);
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
  recordSuccess(ip);
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
      couponCode: r[COL.couponCode] || '',
      discount: Number(r[COL.discount]) || 0,
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
        html: renderOrderStatusEmail({ orderId: req.params.orderId, status, note }),
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
      // Email/Reason/Verification Phrase were stored encrypted (see
      // returns.controller.js) -- decryptText() fails soft (logs +
      // returns the raw stored value) for any pre-encryption row
      // saved before this feature existed, so old requests still
      // render instead of showing garbled ciphertext.
      email: decryptText(r[RCOL.email]),
      items: r[RCOL.items],
      reason: decryptText(r[RCOL.reason]),
      status: r[RCOL.status] || 'Requested',
      imageUrl: r[RCOL.imageUrl] || '',
      videoUrl: r[RCOL.videoUrl] || '',
      challenge: decryptText(r[RCOL.challenge] || ''),
    }))
    .reverse();

  res.json({ ok: true, returns, statuses: RETURN_STATUSES });
});

/* Serves a single return-request photo/video, decrypted on the fly.
   This is the ONLY way to read a return's media now -- the old
   public, unauthenticated /uploads static route is gone (see
   app.js) -- so a link to one of these files is useless without an
   active admin session. path.basename() strips any directory
   components from the param before it ever touches the filesystem,
   so a crafted filename like "../../.env" can't escape
   RETURNS_UPLOAD_DIR. Cache-Control: private, no-store keeps a
   customer's photo/video out of any shared/browser disk cache. */
router.get('/returns/media/:filename', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    return res.status(400).json({ ok: false, error: 'Unrecognized file type.' });
  }
  const filePath = path.join(RETURNS_UPLOAD_DIR, filename);
  let encrypted;
  try {
    encrypted = fs.readFileSync(filePath);
  } catch (err) {
    return res.status(404).json({ ok: false, error: 'File not found.' });
  }
  let decrypted;
  try {
    decrypted = decryptBuffer(encrypted);
  } catch (err) {
    console.error('Failed to decrypt return media:', filename, err.message);
    return res.status(500).json({ ok: false, error: 'Could not decrypt this file.' });
  }
  res.set('Content-Type', mimeType);
  res.set('Cache-Control', 'private, no-store');
  res.send(decrypted);
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

  // No email here by design -- the decision shows up directly on the
  // customer's own order page instead (applyReturnStatus() in
  // orders.html reads this same Status column), which they can check
  // any time, rather than depending on an email actually arriving.
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

/* ── PRODUCT CATALOG ──
   Lets the admin add/edit/remove products without hand-editing
   data/products.json -- a change here shows up on the shop page (and
   the homepage preview cards, which read the same file) on the very
   next page load, no deploy or restart needed. The image itself is
   the one thing multipart/form-data is actually needed for; the rest
   of the fields travel alongside it as ordinary text fields on the
   same request. */

const PRODUCT_IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB -- a single product photo, not a batch

const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    // Same reasoning as returns.controller.js's upload: never trust
    // the original filename, derive a safe extension from the actual
    // mimetype instead.
    filename: (req, file, cb) => {
      const baseType = (file.mimetype || '').split(';')[0];
      const ext = PRODUCT_IMAGE_TYPES[baseType] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const baseType = (file.mimetype || '').split(';')[0];
    cb(null, Object.prototype.hasOwnProperty.call(PRODUCT_IMAGE_TYPES, baseType));
  },
}).single('image');

// Wraps multer so a too-large/wrong-type file becomes a normal
// { ok: false, error } response instead of the generic 500 handler.
function uploadProductImage(req, res, next) {
  productImageUpload(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, error: `That photo is too large (max ${MAX_PRODUCT_IMAGE_BYTES / 1024 / 1024}MB).` });
    }
    if (err) {
      return res.status(400).json({ ok: false, error: 'Could not process that image. Please use a JPG, PNG, or WEBP file.' });
    }
    next();
  });
}

function cleanupUploadedFile(req) {
  if (req.file) require('fs').unlink(req.file.path, () => {});
}

// Shared validation for both create and edit -- returns an error
// string, or null if the fields are usable. Doesn't touch req.file;
// callers decide separately whether an image is required (create) or
// optional (edit, where the existing photo carries over untouched).
// Word count, not character count -- matches the limit the admin form
// enforces client-side. Splitting on whitespace after a trim is good
// enough here (product descriptions are plain English copy, not text
// that needs script-aware word segmentation).
function countWords(str) {
  const trimmed = String(str || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function validateProductFields(body) {
  const name = String(body?.name || '').trim();
  const price = Number(body?.price);
  const wt = String(body?.wt || '').trim();
  const desc = String(body?.desc || '').trim();
  if (!name) return 'Please enter a product name.';
  if (name.length > 80) return 'Product name is too long (max 80 characters).';
  if (!Number.isFinite(price) || price <= 0) return 'Please enter a valid price.';
  if (!wt) return 'Please enter a weight/size (e.g. "500g" or "10 cubes").';
  if (!desc) return 'Please enter a product description.';
  // The word-count cap below doesn't bound total length by itself (one
  // 5,000-character "word" with no spaces would pass it) -- this is
  // just a generous backstop against that, not the real limit.
  if (desc.length > 1500) return 'Description is too long.';
  if (countWords(desc) > 150) return 'Description is too long (max 150 words).';
  if (body?.badge && !Object.prototype.hasOwnProperty.call(VALID_BADGES, body.badge)) {
    return 'Invalid badge selection.';
  }
  return null;
}

router.get('/products', requireAdmin, (req, res) => {
  res.json({ ok: true, products: listProducts(), badges: Object.keys(VALID_BADGES).filter(Boolean) });
});

router.post('/products', requireAdmin, uploadProductImage, async (req, res) => {
  const error = validateProductFields(req.body);
  if (error) {
    cleanupUploadedFile(req);
    return res.status(400).json({ ok: false, error });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Please upload a product photo (JPG, PNG, or WEBP, up to 5MB).' });
  }
  try {
    // addProduct/updateProduct/deleteProduct all go through
    // products.util's serialized write queue (see its comment) --
    // each one returns a Promise that resolves once this write has
    // had its turn and landed on disk, which is why every route here
    // is async and awaits it rather than treating it as synchronous.
    const product = await addProduct({
      ...req.body,
      imgPath: `assets/images/products/${req.file.filename}`,
    });
    res.json({ ok: true, product });
  } catch (err) {
    cleanupUploadedFile(req);
    console.error('Failed to add product:', err.message);
    res.status(500).json({ ok: false, error: 'Could not save that product right now.' });
  }
});

router.put('/products/:id', requireAdmin, uploadProductImage, async (req, res) => {
  const error = validateProductFields(req.body);
  if (error) {
    cleanupUploadedFile(req);
    return res.status(400).json({ ok: false, error });
  }
  try {
    const result = await updateProduct(req.params.id, {
      ...req.body,
      imgPath: req.file ? `assets/images/products/${req.file.filename}` : undefined,
    });
    if (!result) {
      cleanupUploadedFile(req);
      return res.status(404).json({ ok: false, error: 'Product not found.' });
    }
    // A replaced photo's old file is now unreferenced -- clean it up
    // once the new one is safely saved and the catalog is updated.
    if (result.oldImagePath) deleteProductImage(result.oldImagePath);
    res.json({ ok: true, product: result.product });
  } catch (err) {
    cleanupUploadedFile(req);
    console.error('Failed to update product:', err.message);
    res.status(500).json({ ok: false, error: 'Could not update that product right now.' });
  }
});

router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const removed = await deleteProduct(req.params.id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'Product not found.' });
    }
    deleteProductImage(removed.img);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete product:', err.message);
    res.status(500).json({ ok: false, error: 'Could not delete that product right now.' });
  }
});


/* ── COUPONS ──
   data/coupons.json is the one true coupon list (coupons.util.js),
   same "admin edits a file, storefront/checkout reads it immediately"
   pattern as Products. A code's actual rules (percent/flat, active
   window, minimum order, first-order-only) are enforced server-side
   at both the cart's "Apply" preview and checkout's create-order
   (coupons.util's validateCoupon) -- this screen only edits the
   rules, it never computes a discount for a real cart itself. */

router.get('/coupons', requireAdmin, (req, res) => {
  res.json({ ok: true, coupons: listCoupons() });
});

router.post('/coupons', requireAdmin, async (req, res) => {
  const error = validateCouponFields(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  try {
    const coupon = await addCoupon(req.body);
    if (!coupon) return res.status(409).json({ ok: false, error: 'That code already exists.' });
    res.json({ ok: true, coupon });
  } catch (err) {
    console.error('Failed to add coupon:', err.message);
    res.status(500).json({ ok: false, error: 'Could not save that code right now.' });
  }
});

router.put('/coupons/:code', requireAdmin, async (req, res) => {
  const error = validateCouponFields(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  try {
    const result = await updateCoupon(req.params.code, req.body);
    if (result === null) return res.status(404).json({ ok: false, error: 'Code not found.' });
    if (result === 'duplicate') return res.status(409).json({ ok: false, error: 'Another code already uses that name.' });
    res.json({ ok: true, coupon: result });
  } catch (err) {
    console.error('Failed to update coupon:', err.message);
    res.status(500).json({ ok: false, error: 'Could not update that code right now.' });
  }
});

router.delete('/coupons/:code', requireAdmin, async (req, res) => {
  try {
    const removed = await deleteCoupon(req.params.code);
    if (!removed) return res.status(404).json({ ok: false, error: 'Code not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete coupon:', err.message);
    res.status(500).json({ ok: false, error: 'Could not delete that code right now.' });
  }
});

module.exports = router;
