/* =========================================
   Customer session handling.
   Google only tells us who signed in (via an ID token) — it doesn't
   give us a session mechanism, so after verifying that token once
   (routes/auth.js) we issue our OWN signed, httpOnly cookie. Every
   later request just needs to verify that cookie, not talk to Google
   again.
   ========================================= */
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'bs_session';
const SESSION_DAYS = 30;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set in .env');
  return secret;
}

function signSession(user) {
  return jwt.sign(
    { email: user.email, name: user.name, picture: user.picture || null },
    getSecret(),
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

function verifySession(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    // Allow plain HTTP only in local dev; Hostinger should set
    // NODE_ENV=production so real cookies require HTTPS.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const user = token && verifySession(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Please sign in.' });
  req.user = user;
  next();
}


/* =========================================
   Admin session — completely separate from customer sessions. A
   single shared password (ADMIN_PASSWORD in .env) is enough here
   since there's one business owner, not a multi-user admin team.
   ========================================= */
const bcrypt = require('bcryptjs');

const ADMIN_COOKIE_NAME = 'bs_admin';
const ADMIN_SESSION_HOURS = 12;

// The admin password is never stored in plain text -- only its
// bcrypt hash lives in .env (ADMIN_PASSWORD_HASH), the same way a
// real user-account password would be stored. bcrypt.compare() is
// already constant-time with respect to the candidate password (it
// re-hashes and compares the digest), which is what the old
// crypto.timingSafeEqual() call here was protecting against for a
// plain-text comparison -- that protection is now bcrypt's job
// instead. To change the admin password: generate a new hash with
// `node -e "console.log(require('bcryptjs').hashSync('new-password', 12))"`
// and replace ADMIN_PASSWORD_HASH in .env.
async function checkAdminPassword(candidate) {
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (!hash) return false;
  return bcrypt.compare(String(candidate || ''), hash);
}

function signAdminSession() {
  return jwt.sign({ admin: true }, getSecret(), { expiresIn: `${ADMIN_SESSION_HOURS}h` });
}

function verifyAdminSession(token) {
  try {
    const decoded = jwt.verify(token, getSecret());
    return decoded?.admin ? decoded : null;
  } catch {
    return null;
  }
}

function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: ADMIN_SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  };
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  const session = token && verifyAdminSession(token);
  if (!session) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  next();
}

module.exports = {
  COOKIE_NAME, signSession, verifySession, cookieOptions, requireAuth,
  ADMIN_COOKIE_NAME, checkAdminPassword, signAdminSession, verifyAdminSession, adminCookieOptions, requireAdmin,
};
