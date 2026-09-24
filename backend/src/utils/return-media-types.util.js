/* =========================================
   Single source of truth for return-request media: allowed types,
   size limits, and where the encrypted files live on disk. Both
   returns.controller.js (writes files) and admin.controller.js
   (reads/decrypts them for the admin dashboard) import from here
   rather than keeping their own copies -- see returns-schema.util.js
   for why duplicated constants like this are exactly what caused a
   real bug here before (orders.js's stale copy of the Returns column
   layout silently breaking a lookup).
   ========================================= */
const path = require('path');
const fs = require('fs');

// Uploads live outside backend/public (which is what's served to the
// web) -- historically served for free via a public express.static
// mount, now served only through the authenticated, decrypting route
// in admin.controller.js (GET /api/admin/returns/media/:filename).
const RETURNS_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'returns');
fs.mkdirSync(RETURNS_UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

// Reverse lookup (extension -> mimetype) for the media-serving route,
// which only has the filename to go on once it's decrypted the file.
const EXT_TO_MIME = {};
for (const [mime, ext] of Object.entries(IMAGE_TYPES)) EXT_TO_MIME[ext] = mime;
for (const [mime, ext] of Object.entries(VIDEO_TYPES)) EXT_TO_MIME[ext] = mime;

module.exports = { RETURNS_UPLOAD_DIR, IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, EXT_TO_MIME };
