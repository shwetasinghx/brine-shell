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

const app = express();

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
app.use('/api/auth', authLimiter, authRoute);
app.use('/api/orders', formLimiter, ordersRoute);
app.use('/api/returns', formLimiter, returnsRoute);
app.use('/api/profile', formLimiter, profileRoute);
app.use('/api/addresses', formLimiter, addressesRoute);
app.use('/api/reviews', formLimiter, reviewsRoute);
app.use('/api/admin/login', adminLoginLimiter);
app.use('/api/admin', adminRoute);

app.use(errorHandler);

const frontendPath = path.join(__dirname, '..', '..', frontendDirectory);
const uploadsPath = path.join(__dirname, '..', '..', 'uploads');

// Keep page files fresh after deployment while allowing images/uploads to cache normally.
app.use(express.static(frontendPath, {
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));
app.use('/uploads', express.static(uploadsPath, { dotfiles: 'ignore' }));

module.exports = app;
