const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { signSession, verifySession, cookieOptions, COOKIE_NAME } = require('../utils/auth.util');

const router = express.Router();

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set in .env');
  return new OAuth2Client(clientId);
}

/* Frontend sends the ID token it got from Google Identity Services
   (see js/auth.js). We verify it really came from Google and really
   belongs to our Client ID, then issue our own session cookie —
   Google is only consulted at sign-in time, never again per request. */
router.post('/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ ok: false, error: 'Missing Google credential.' });
  }

  let payload;
  try {
    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    return res.status(401).json({ ok: false, error: 'Could not verify your Google sign-in.' });
  }

  if (!payload?.email) {
    return res.status(401).json({ ok: false, error: 'Google did not return an email address.' });
  }

  const user = { email: payload.email, name: payload.name || payload.email, picture: payload.picture || null };
  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, user });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

function meHandler(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  const user = token && verifySession(token);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { email: user.email, name: user.name, picture: user.picture } });
}

// Also reachable as GET /api/auth/me for consistency with the other
// auth routes, but js/auth.js calls the top-level GET /api/me
// (mounted directly in server.js) — kept here too in case anything
// links to the /api/auth/ prefixed version.
router.get('/me', meHandler);

module.exports = router;
module.exports.meHandler = meHandler;
