/* =========================================
   Admin login lockout.
   Layered on top of the existing IP rate limiter in
   rate-limit.middleware.js (100 attempts/15min) -- that's a hard
   ceiling meant to stop a flood; this is what actually discourages a
   patient, slow brute force against the one shared admin password:
   each wrong guess makes the NEXT one cost more time, escalating
   fast (2s, 4s, 8s, 16s... capped at 5 minutes) from the 3rd
   consecutive failure. A correct password immediately clears it.

   In-memory only, keyed by IP -- there's a single business owner and
   a single Node process (see backend/README.md's Hostinger deploy
   notes), so this doesn't need Redis or a database table. The
   tradeoff: a server restart, or ever running more than one instance,
   resets everyone's count. Fine at this scale; would need moving to
   a shared store if that ever changes.
   ========================================= */

const attempts = new Map(); // ip -> { count, lockedUntil }

const BASE_DELAY_MS = 2000;         // delay once the 3rd failure lands
const MAX_DELAY_MS = 5 * 60 * 1000; // cap at 5 minutes
const LOCK_AFTER = 3;               // first two wrong guesses are free (typos happen)

function delayForCount(count) {
  const ms = BASE_DELAY_MS * Math.pow(2, count - LOCK_AFTER);
  return Math.min(ms, MAX_DELAY_MS);
}

// { locked: false } or { locked: true, retryAfterSeconds }
function checkLocked(ip) {
  const entry = attempts.get(ip);
  if (!entry || !entry.lockedUntil) return { locked: false };
  const remainingMs = entry.lockedUntil - Date.now();
  if (remainingMs <= 0) return { locked: false };
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

function recordFailure(ip) {
  const entry = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOCK_AFTER) {
    entry.lockedUntil = Date.now() + delayForCount(entry.count);
  }
  attempts.set(ip, entry);
}

function recordSuccess(ip) {
  attempts.delete(ip);
}

module.exports = { checkLocked, recordFailure, recordSuccess };
