const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { getRows, appendRow } = require('../services/sheets.service');
const { RETURNS_COL } = require('../utils/returns-schema.util');
const { requireAuth } = require('../utils/auth.util');
const { sendEmail } = require('../services/mailer.service');
const { encryptBuffer, encryptText } = require('../utils/crypto.util');
const { RETURNS_UPLOAD_DIR, IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } = require('../utils/return-media-types.util');

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

// Limits/types (IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE_BYTES,
// MAX_VIDEO_BYTES) reflect what mainstream Indian D2C return flows
// (Amazon/Flipkart/Myntra-style) typically accept as of today: a
// single photo well under 10MB, and a short unboxing/issue clip under
// ~60 seconds -- generous enough for a phone camera, small enough
// that a Sheets-only, self-hosted backend with no CDN doesn't choke
// on disk/bandwidth from a handful of large uploads. Now shared with
// admin.controller.js via utils/return-media-types.util.js.
// multer's own `limits.fileSize` can't differ per field, so it's set
// to the larger of the two here just to stop something wildly
// oversized before it's even fully buffered into memory -- the real,
// field-specific 8MB / 50MB check happens after upload, in the route.
const MULTER_HARD_CAP = MAX_VIDEO_BYTES;

// Files are buffered in memory (not written to disk by multer
// itself) so this route can encrypt each one before anything ever
// touches disk in plain form -- see encryptBuffer() below, right
// before the write. At the size caps above (max 50MB) this is a
// perfectly reasonable amount of transient memory for a single
// upload; a much higher-volume deployment would want to switch to a
// streaming cipher instead of buffering the whole file, but that's
// not this scale.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_HARD_CAP },
  // Type is not enforced here -- see the explicit checks in the route
  // handler below for why. This just accepts whatever arrives;
  // multer's own size cap above is still the only gate at this stage.
  fileFilter: (req, file, cb) => cb(null, true),
});

// With memoryStorage, multer never writes anything to disk on its
// own, so there's nothing to clean up here any more -- kept as a
// no-op (rather than deleting every call site below) so a future
// storage-engine change can't silently reintroduce a leak without
// this function's job becoming relevant again.
function cleanupFiles() {}

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
      console.error('Return upload rejected by multer -- file too large:', { field: err.field, contentLength: req.headers['content-length'] });
      cleanupFiles(req.files);
      return res.status(400).json({ ok: false, error: `That file is too large. Photos max ${MAX_IMAGE_BYTES / 1024 / 1024}MB, videos max ${MAX_VIDEO_BYTES / 1024 / 1024}MB.` });
    }
    if (err) {
      // Logged with the raw error code/name -- a reverse proxy or
      // hosting layer in front of this app (e.g. on the live
      // Hostinger deployment, as opposed to local `npm start`) can
      // impose its own request-size ceiling below multer's own, and
      // that shows up here as a stream/parse error rather than a
      // clean MulterError.
      console.error('Return upload failed while parsing multipart body:', { code: err.code || err.name, message: err.message, contentLength: req.headers['content-length'] });
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

  // Logged on every attempt (not just failures) so a "please attach
  // a video" rejection with a client that swears it sent one can be
  // checked against what the server actually received -- content-
  // length proves whether the video's bytes left the browser at all,
  // and which of req.files' keys are present shows exactly which
  // field, if any, went missing in transit.
  console.log('Return upload received:', {
    contentLength: req.headers['content-length'] || 'unknown',
    fieldsPresent: Object.keys(req.files || {}),
    image: imageFile ? `${imageFile.size}B ${imageFile.mimetype}` : 'MISSING',
    video: videoFile ? `${videoFile.size}B ${videoFile.mimetype}` : 'MISSING',
  });

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
  // Type is checked here instead of in multer's fileFilter (see
  // above) specifically so a real mismatch is reported with the
  // actual mimetype that arrived, both to the customer and in the
  // server log -- rather than looking identical to the file never
  // having been attached at all.
  const imageBaseType = (imageFile.mimetype || '').split(';')[0];
  if (!Object.prototype.hasOwnProperty.call(IMAGE_TYPES, imageBaseType)) {
    console.error('Return request rejected -- unsupported photo type:', imageFile.mimetype);
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: `That photo's file type (${imageBaseType || 'unrecognized'}) isn't supported. Please use JPG, PNG, WEBP or HEIC.` });
  }
  const videoBaseType = (videoFile.mimetype || '').split(';')[0];
  if (!Object.prototype.hasOwnProperty.call(VIDEO_TYPES, videoBaseType)) {
    console.error('Return request rejected -- unsupported video type:', videoFile.mimetype);
    cleanupFiles(req.files);
    return res.status(400).json({ ok: false, error: `That video's file type (${videoBaseType || 'unrecognized'}) isn't supported. Please use MP4, MOV or WEBM.` });
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

  // A unique id per request (not just Order ID) so admin can approve
  // or cancel one specific return even if the same order ends up with
  // more than one over time. Appended as a LATE column rather than
  // inserted up front, so it lines up with an existing sheet by just
  // adding more columns at the end -- same pattern as Addresses'
  // Pincode/City/State -- instead of shifting every existing column
  // over, which would misalign any rows already in the sheet.
  const returnId = `ret_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // Never trust the original filename -- random name + a safe
  // extension derived from the actual mimetype avoids both
  // collisions and path-traversal tricks via the upload's filename.
  // The bytes written to disk here are the AES-256-GCM CIPHERTEXT,
  // never the original photo/video -- encryptBuffer() prepends its
  // own random IV and auth tag, so even the raw file on disk is
  // useless without DATA_ENCRYPTION_KEY. These files are no longer
  // reachable at all under the old public /uploads static route (see
  // app.js); they're only ever served back out, decrypted, through
  // the requireAdmin-gated GET /returns/media/:filename route below.
  const imageExt = IMAGE_TYPES[imageBaseType];
  const videoExt = VIDEO_TYPES[videoBaseType];
  const imageFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${imageExt}`;
  const videoFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${videoExt}`;
  try {
    fs.writeFileSync(path.join(RETURNS_UPLOAD_DIR, imageFilename), encryptBuffer(imageFile.buffer));
    fs.writeFileSync(path.join(RETURNS_UPLOAD_DIR, videoFilename), encryptBuffer(videoFile.buffer));
  } catch (err) {
    console.error('Encrypting/writing return media failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not save those files right now. Please try again.' });
  }
  const imageUrl = `/api/admin/returns/media/${imageFilename}`;
  const videoUrl = `/api/admin/returns/media/${videoFilename}`;

  try {
    // Returns sheet header: Timestamp | Order ID | Customer Email | Items | Reason | Status | Image URL | Return ID | Video URL | Verification Phrase
    // Email/Reason/Verification Phrase are personal/free-text fields
    // with no lookup use anywhere in the codebase (confirmed via a
    // full grep of controllers/*.js), so they're the ones encrypted
    // at rest here -- Order ID/Status/Image URL/Return ID/Video URL
    // all stay plaintext because other routes match on them exactly
    // (orders.controller.js, this file's own dup-check above,
    // reviews.controller.js, and the admin status-update route).
    await appendRow('Returns', [
      new Date().toISOString(),
      orderId,
      encryptText(req.user.email),
      order[COL.items] || '',
      encryptText(reason),
      'Requested',
      imageUrl,
      returnId,
      videoUrl,
      encryptText(challenge),
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
        <p><strong>Photo/Video:</strong> sign in to the admin dashboard's Return Requests tab to view -- these files are encrypted at rest and only viewable there, not via a plain link.</p>
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
