/* =========================================
   Razorpay order creation + payment verification.
   The amount is NEVER taken from the client — see routes/checkout.js,
   which recomputes it from data/products.json before calling
   createOrder(). This is the fix for the "client can edit the total
   in devtools" red flag from the site audit.
   ========================================= */
const crypto = require('crypto');
const Razorpay = require('razorpay');

function getClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing in .env)');
  }
  return new Razorpay({ key_id, key_secret });
}

async function createOrder({ amountInPaise, currency, receipt, notes }) {
  const rzp = getClient();
  return rzp.orders.create({ amount: amountInPaise, currency, receipt, notes });
}

function verifySignature({ orderId, paymentId, signature }) {
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto
    .createHmac('sha256', key_secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

/* Verifies a webhook delivery from Razorpay's servers (Settings ->
   Webhooks in the dashboard) against a SEPARATE secret you set there
   — not the API key secret. This is the reliable backstop: unlike
   the browser-driven /verify call above, this fires even if the
   customer closes the tab right after paying, so a payment can never
   go recorded-as-paid-at-Razorpay-but-still-"pending"-in-our-sheet
   just because the browser didn't stick around. */
function verifyWebhookSignature({ rawBody, signature }) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

// Constant-time comparison — a plain === on signatures would leak
// timing information an attacker could use to guess the correct
// value one byte at a time.
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

module.exports = {
  createOrder,
  verifySignature,
  verifyWebhookSignature,
  getKeyId: () => process.env.RAZORPAY_KEY_ID,
};
