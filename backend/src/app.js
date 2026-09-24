const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { allowedOrigin, frontendDirectory } = require('./config/app.config');
const { formLimiter, authLimiter, adminLoginLimiter } = require('./middleware/rate-limit.middleware');
const { errorHandler } = require('./middleware/error.middleware');
const contactRoute = require('./routes/contact.routes');
const newsletterRoute = require('./routes/newsletter.routes');
const checkoutRoute = require('./routes/checkout.routes');
const authRoute = require('./routes/auth.routes');
const ordersRoute = require('./routes/orders.routes');
const returnsRoute = require('./routes/returns.routes');
const profileRoute = require('./routes/profile.routes');
const addressesRoute = require('./routes/addresses.routes');
const reviewsRoute = require('./routes/reviews.routes');
const adminRoute = require('./routes/admin.routes');
const couponsRoute = require('./routes/coupons.routes');

const app = express();

// Hostinger (and most other Node hosts) sit the app behind their own
// reverse proxy (LiteSpeed here), which adds an X-Forwarded-For
// header to every request. Without this, Express doesn't trust that
// header, so req.ip falls back to the proxy's own address for every
// visitor -- meaning express-rate-limit would key every rate limiter
// off a single shared "IP" instead of each real client, and logs a
// ValidationError warning about it on every request. `1` trusts
// exactly one hop (the proxy in front of us), which is correct for
// this single-proxy setup; it would need to be a specific IP/CIDR
// list if there were ever more than one proxy hop in front of the app.
app.set('trust proxy', 1);

// Captures the raw request body alongside Express's normal JSON
// parsing — the webhook route needs the exact raw bytes to verify
// Razorpay's HMAC signature; every other route just uses req.body
// as before.
app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());

// credentials:true is required for the session cookie to be sent/set
// on cross-origin requests (e.g. the API on a subdomain) — it also
// means ALLOWED_ORIGIN can't be '*', it must be a real origin.
app.use(cors({ origin: allowedOrigin, credentials: true }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/me', authRoute.meHandler);

app.use('/api/contact', formLimiter, contactRoute);
app.use('/api/newsletter', formLimiter, newsletterRoute);
app.use('/api/checkout', checkoutRoute);
app.use('/api/coupons', formLimiter, couponsRoute);
app.use('/api/auth', authLimiter, authRoute);
app.use('/api/orders', formLimiter, ordersRoute);
app.use('/api/returns', formLimiter, returnsRoute);
app.use('/api/profile', formLimiter, profileRoute);
app.use('/api/addresses', formLimiter, addressesRoute);
app.use('/api/reviews', formLimiter, reviewsRoute);
app.use('/api/admin/login', adminLoginLimiter);
app.use('/api/admin', adminRoute);

app.use(errorHandler);

const frontendPath = path.join(__dirname, '..', frontendDirectory);

// Keep page files fresh after deployment while allowing images/uploads to cache normally.
app.use(express.static(frontendPath, {
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));
// The old public, unauthenticated /uploads static mount is gone --
// return-request photos/videos are encrypted at rest and now only
// served through the requireAdmin-gated GET /api/admin/returns/media/:filename
// route (see admin.controller.js). Nothing else was ever served from
// this directory (product images live under public/assets/ via the
// static mount above), so removing this line closes that route off
// entirely rather than replacing it with a narrower version.

module.exports = app;
