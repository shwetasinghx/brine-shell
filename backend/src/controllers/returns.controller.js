const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { getRows, appendRow } = require('../services/sheets.service');
const { RETURNS_COL } = require('../utils/returns-schema.util');
const { requireAuth } = require('../utils/auth.util');
const { sendEmail } = require('../services/resend.service');

const router = express.Router();

// Orders sheet columns this route needs (see backend/README.md for
// the full header row).
const COL = { id: 0, items: 6, status: 8, deliveredAt: 9, accountEmail: 10 };

// A return can only be requested once an order has actually arrived,
// and only for a short window after that -- not indefinitely. Two
// days mirrors how most Indian D2C brands handle a damage/issue
// report (long enough to unbox and check, short enough that "the
// order" and "the return window" stay the same conversation).
const RETURN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// Same "keep it short" reasoning as the address field: a return
// reason is a quick description of the problem, not an essay. Capped
// by word count (not just character count) so it lines up with what
// the customer actually sees happen on screen -- orders.html caps the
// textarea at 100 words live as they type.
const REASON_MAX_WORDS = 100;

// Uploads live outside backend/ (which is blocked from the web in
// server.js) so they're served for free by the same express.static
// that already serves the rest of the site -- a saved file at
// <repo root>/uploads/returns/x.jpg is public at /uploads/returns/x.jpg.
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'returns');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Limits/types below reflect what mainstream Indian D2C return flows
// (Amazon/Flipkart/Myntra-style) typically accept as of today: a
// single photo well under 10MB, and a short unboxing/issue clip under
// ~60 seconds -- generous enough for a phone camera, small enough
// that a Sheets-only, self-hosted backend with no CDN doesn't choke
// on disk/bandwidth from a handful of large uploads.
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
// multer's own `limits.fileSize` can't differ per field, so it's set
// to the larger of the two here just to stop something wildly
// oversized before it's even fully written to disk -- the real,
// field-specific 8MB / 50MB check happens after upload, in the route.
const MULTER_HARD_CAP = MAX_VIDEO_BYTES;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Never trust the original filename -- random name + a safe
    // extension derived from the actual mimetype avoids both
    // collisions and path-traversal tricks via the upload's filename.
    filename: (req, file, cb) => {
      const baseType = (file.mimetype || '').split(';')[0];
      const ext = IMAGE_TYPES[baseType] || VIDEO_TYPES[baseType] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MULTER_HARD_CAP },
  fileFilter: (req, file, cb) => {
    const allowed = file.fieldname === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
    const baseType = (file.mimetype || '').split(';')[0];
    cb(null, Object.prototype.hasOwnProperty.call(allowed, baseType));
  },
});

function cleanupFiles(files) {
  if (!files) return;
  Object.values(files).flat().forEach(f => fs.unlink(f.path, () => {}));
}

/* A return request requires a written description, a photo of the
   issue, AND an unboxing/issue video -- multer parses the multipart
   body, so req.body has the text fields and req.files.image / .video
   hold whichever files made it through (each is an array; empty or
   missing if none was attached, or if it failed the type check). */
// Wraps multer so a too-large or wrong-type file becomes a normal
// { ok: false, error } response instead of falling through to the
// generic 500 handler in server.js.
function uploadFiles(req, res, next) {
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }])(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      cleanupFiles(req.files);
      return res.status(400).json({ ok: false, error: `That file is too large. Photos max ${MAX_IMAGE_BYTES / 1024 / 1024}MB, videos max ${MAX_VIDEO_BYTES / 1024 / 1024}MB.` });
    }
    if (err) {
      cleanupFiles(req.files);
      return res.status(400).json({ ok: false, error: 'Could not process those files. Please check the format and try again.' });
    }
    next();
  });
}

router.post('/', requireAuth, uploadFiles, async (req, res) => {
  const orderId = String(req.body?.orderId || '').trim();
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  // The order id + date phrase orders.html displayed and asked the
  // customer to say out loud while recording -- not verified
  // automatically (nothing here can watch/listen to the video), just
  // logged so the admin has the exact expected phrase on hand during
  // manual review instead of having to reconstruct it.
  const challenge = String(req.body?.challenge || '').trim().slice(0, 200);
  const imageFile = req.files?.image?.[0];
  const videoFile = req.files?.video?.[0];

  if (!orderId || !reason) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: 'Please select an order and describe the issue.' });
  }
  if (reason.split(/\s+/).filter(Boolean).length > REASON_MAX_WORDS) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: `Keep the issue description to ${REASON_MAX_WORDS} words or fewer.` });
  }
  if (!imageFile) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: 'Please attach a photo of the issue (JPG, PNG, WEBP or HEIC, up to 8MB).' });
  }
  if (!videoFile) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: 'Please attach a short unboxing/issue video (MP4, MOV or WEBM, up to 50MB).' });
  }
  // Field-specific size limits -- multer's shared cap above only
  // catches something over the larger (video) ceiling.
  if (imageFile.size > MAX_IMAGE_BYTES) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: `That photo is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB). Please choose a smaller file.` });
  }
  if (videoFile.size > MAX_VIDEO_BYTES) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: `That video is too large (max ${MAX_VIDEO_BYTES / 1024 / 1024}MB). Please trim it or choose a shorter clip.` });
  }

  let rows;
  try {
    rows = await getRows('Orders');
  } catch (err) {
    console.error('Sheets read failed (returns):', err.message);
    cleanupFiles(req.files);
    return res.status(502).json({ ok: false, error: 'Could not look up that order right now.' });
  }

  // Ownership check uses Account Email (the signed-in account a
  // return can only be filed from), not the freely-editable contact
  // Email column -- same "Email vs Account Email" split as everywhere
  // else in this backend.
  const order = rows.slice(1).find(r => r[COL.id] === orderId);
  if (!order || (order[COL.accountEmail] || '').toLowerCase() !== req.user.email.toLowerCase()) {
    cleanupFiles(req.files);
    return res.status(404).json({ ok: false, error: 'Order not found.' });
  }

  // A return can only be requested once delivered, and only within
  // the 2-day window after that -- enforced here too, not just by
  // hiding the button, since the endpoint is the actual gate.
  if (order[COL.status] !== 'Delivered') {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: 'Returns can only be requested once an order has been delivered.' });
  }
  const deliveredAt = order[COL.deliveredAt] ? new Date(order[COL.deliveredAt]) : null;
  if (!deliveredAt || Number.isNaN(deliveredAt.getTime()) || (Date.now() - deliveredAt.getTime()) > RETURN_WINDOW_MS) {
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: 'The 2-day return window for this order has closed.' });
  }

  // One return request per order, period -- not one per outcome. A
  // customer can't file a second attempt just because the first was
  // cancelled (bad/insufficient info); at that point it's a support
  // conversation, not a self-service resubmission.
  let existingReturns;
  try {
    existingReturns = await getRows('Returns');
  } catch (err) {
    console.error('Sheets read failed (returns dup-check):', err.message);
    cleanupFiles(req.files);
    return res.status(502).json({ ok: false, error: 'Could not check existing return requests right now.' });
  }
  if (existingReturns.slice(1).some(r => r[RETURNS_COL.orderId] === orderId)) {
    cleanupFiles(req.files);
    return res.status(409).json({ ok: false, error: 'A return request has already been submitted for this order.' });
  }

  const imageUrl = `/uploads/returns/${imageFile.filename}`;
  const videoUrl = `/uploads/returns/${videoFile.filename}`;

  // A unique id per request (not just Order ID) so admin can approve
  // or cancel one specific return even if the same order ends up with
  // more than one over time. Appended as a LATE column rather than
  // inserted up front, so it lines up with an existing sheet by just
  // adding more columns at the end -- same pattern as Addresses'
  // Pincode/City/State -- instead of shifting every existing column
  // over, which would misalign any rows already in the sheet.
  const returnId = `ret_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  try {
    // Returns sheet header: Timestamp | Order ID | Customer Email | Items | Reason | Status | Image URL | Return ID | Video URL | Verification Phrase
    await appendRow('Returns', [
      new Date().toISOString(),
      orderId,
      req.user.email,
      order[COL.items] || '',
      reason,
      'Requested',
      imageUrl,
      returnId,
      videoUrl,
      challenge,
    ]);
  } catch (err) {
    console.error('Sheets append failed (returns):', err.message);
    return res.status(502).json({ ok: false, error: 'Could not submit your return request right now.' });
  }

  try {
    const origin = process.env.ALLOWED_ORIGIN || '';
    await sendEmail({
      to: process.env.CONTACT_TO_EMAIL,
      replyTo: req.user.email,
      subject: `Return requested for order ${orderId}`,
      html: `
        <p><strong>Order:</strong> ${orderId}</p>
        <p><strong>Customer:</strong> ${req.user.name} (${req.user.email})</p>
        <p><strong>Items:</strong> ${order[COL.items] || ''}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Photo:</strong> <a href="${origin}${imageUrl}">${imageUrl}</a></p>
        <p><strong>Video:</strong> <a href="${origin}${videoUrl}">${videoUrl}</a></p>
        ${challenge ? `<p><strong>Customer was asked to say:</strong> ${challenge}</p>` : ''}
      `,
    });
  } catch (err) {
    console.error('Email send failed (returns):', err.message);
    // Not fatal -- the request is already logged in the sheet above.
  }

  res.json({ ok: true });
});

module.exports = router;
