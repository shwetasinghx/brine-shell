const express = require('express');
const rateLimit = require('express-rate-limit');
const { priceCart } = require('../utils/catalog.util');
const { createOrder, verifySignature, verifyWebhookSignature, getKeyId } = require('../services/razorpay.service');
const { appendRow, updateRowByKey, getRows } = require('../services/sheets.service');
const { sendEmail } = require('../services/resend.service');
const { requireAuth } = require('../utils/auth.util');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Scoped to the customer-facing endpoints only — deliberately NOT
// applied to /webhook below, which is server-to-server traffic from
// Razorpay's own infrastructure and shouldn't share a rate-limit
// bucket with browser checkout attempts.
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });

// Orders sheet columns, same layout routes/orders.js and admin.js use.
const COL = { id: 0, date: 1, paymentStatus: 2, name: 3, email: 4, phone: 5, items: 6, total: 7, status: 8 };

/* The single place that flips an order to "paid" — called from BOTH
   the browser's /verify request and the /webhook route below, so
   whichever one arrives first does the work and the other becomes a
   no-op. Without this idempotency check, a customer whose browser
   completes /verify AND whose payment also triggers a webhook
   delivery would get two confirmation emails for one order. */
async function markOrderPaid(orderId, paymentId) {
  const rows = await getRows('Orders');
  const row = rows.slice(1).find(r => r[COL.id] === orderId);
  if (!row) return { found: false };
  if (row[COL.paymentStatus] === 'paid') return { found: true, alreadyPaid: true };

  await updateRowByKey('Orders', orderId, { C: 'paid', I: 'Order Placed' });

  const email = row[COL.email];
  if (email && EMAIL_RE.test(email)) {
    try {
      await sendEmail({
        to: email,
        subject: 'Your Brine & Shell order is confirmed',
        html: `<p>Thanks for your order! Payment reference: <strong>${paymentId}</strong>.</p><p>We'll be in touch with delivery updates.</p>`,
      });
    } catch (err) {
      console.error('Email send failed (order confirmation):', err.message);
    }
  }
  return { found: true, alreadyPaid: false };
}

/* Step 1: browser sends { items: [{id, qty}], customer: {name, email, phone} }.
   We price the cart ourselves from data/products.json — the amount
   the browser thinks the total is never gets trusted — then ask
   Razorpay to create an order for that (server-computed) amount.
   requireAuth is the actual security boundary here: an order can no
   longer be created by a guest at all, so accountEmail is always the
   verified signed-in email, never blank. (The frontend also hides the
   checkout flow from signed-out visitors -- see shop.html -- but that's
   just UX; this middleware is what makes guest checkout impossible.) */
router.post('/create-order', checkoutLimiter, requireAuth, async (req, res) => {
  const { items, customer } = req.body || {};
  const name = String(customer?.name || '').trim().slice(0, 120);
  const email = String(customer?.email || '').trim().slice(0, 200);
  const phone = String(customer?.phone || '').trim().slice(0, 20);
  const address = String(customer?.address || '').trim().slice(0, 400);

  if (!name || !email || !phone || !address) {
    return res.status(400).json({ ok: false, error: 'Please fill in your name, email, phone and delivery address.' });
  }
  if (address.length < 10) {
    return res.status(400).json({ ok: false, error: 'Please enter a complete delivery address.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn\'t look right.' });
  }
  if (phone.replace(/\D/g, '').length !== 10) {
    return res.status(400).json({ ok: false, error: 'Enter a valid 10-digit phone number.' });
  }

  // "Email" (typed above) is contact info for THIS order and stays
  // whatever the customer enters -- it's fine for that to differ from
  // their account. "Account Email" is separate: it's always the
  // signed-in session's own email now that requireAuth guards this
  // route (guest checkout is no longer possible), and it's the ONLY
  // thing "My Orders" matches against, so editing the contact email
  // can never make a real order invisible to its own account.
  const accountEmail = req.user.email.toLowerCase();

  let priced;
  try {
    priced = priceCart(items);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  const receipt = `bs_${Date.now()}`;
  let order;
  try {
    order = await createOrder({
      amountInPaise: priced.total * 100,
      currency: priced.currency,
      receipt,
      notes: { name, email, phone },
    });
  } catch (err) {
    console.error('Razorpay order creation failed:', err.message || err);
    return res.status(502).json({ ok: false, error: 'Could not start checkout right now. Please try again shortly.' });
  }

  try {
    // "cubes:2;dual:1" -- a compact, parseable record of exactly which
    // product ids (and quantities) were in this order, appended as a
    // new LAST column same as every other schema addition in this
    // sheet. The existing "Items" column is a display string built
    // from product NAMES ("Peanut Butter Cubes x2; ..."), which is
    // fine for showing a human but useless for matching a review back
    // to a real product id -- this is what lets "review this product"
    // on orders.html know which products are actually reviewable for
    // a given order, without guessing from display text.
    const itemIds = priced.lineItems.map(i => `${i.id}:${i.qty}`).join(';');

    // Column order matches the Orders sheet header:
    // Order ID | Date | Payment Status | Name | Email | Phone | Items | Total | Fulfillment Status | Delivered At | Account Email | Address | Item IDs
    await appendRow('Orders', [
      order.id,
      new Date().toISOString(),
      'pending',
      name,
      email,
      phone,
      priced.lineItems.map(i => `${i.name} x${i.qty}`).join('; '),
      priced.total,
      '', // fulfillment status is set once payment is verified
      '', // delivered-at timestamp, filled in only once status reaches "Delivered"
      accountEmail, // signed-in account's email, if any -- used only to match "My Orders"
      address, // delivery address typed at checkout -- shown to the admin for fulfillment
      itemIds,
    ]);
  } catch (err) {
    console.error('Sheets append failed (order):', err.message);
    // Not fatal — the order still exists in Razorpay; don't block checkout.
  }

  res.json({
    ok: true,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: getKeyId(),
    summary: priced,
  });
});

/* Step 2: after Razorpay's checkout modal completes, the browser
   sends back the payment id + signature. We verify the signature
   ourselves (never trust "it worked" from the client alone) before
   marking the order paid and emailing a confirmation. */
router.post('/verify', checkoutLimiter, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ ok: false, error: 'Missing payment verification fields.' });
  }

  const valid = verifySignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!valid) {
    console.error('Razorpay signature mismatch for order', razorpay_order_id);
    return res.status(400).json({ ok: false, error: 'Payment could not be verified.' });
  }

  try {
    await markOrderPaid(razorpay_order_id, razorpay_payment_id);
  } catch (err) {
    console.error('Sheets update failed (order verify):', err.message);
    // The signature is genuinely valid at this point — payment succeeded
    // even though we couldn't record it. The webhook below is the
    // backstop that will still catch this and mark it paid once Sheets
    // is reachable again.
  }

  res.json({ ok: true });
});

/* Server-to-server backstop. Configured once in the Razorpay
   dashboard (Settings -> Webhooks) with this URL and a secret you
   generate there — a DIFFERENT secret from RAZORPAY_KEY_SECRET.
   Razorpay calls this directly from its own servers the moment a
   payment is captured, regardless of whether the customer's browser
   ever made it back to /verify (closed the tab, lost connection,
   phone died mid-redirect, etc.). This is what makes "payment
   succeeded but our records say pending" structurally impossible
   instead of just unlikely. */
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!signature || !req.rawBody || !verifyWebhookSignature({ rawBody: req.rawBody, signature })) {
    console.error('Webhook signature verification failed');
    return res.status(400).json({ ok: false, error: 'Invalid signature.' });
  }

  const event = req.body?.event;
  const payment = req.body?.payload?.payment?.entity;

  if (event === 'payment.captured' && payment?.order_id) {
    try {
      const result = await markOrderPaid(payment.order_id, payment.id);
      console.log(`Webhook: payment.captured for ${payment.order_id}`, result.alreadyPaid ? '(already marked paid — no-op)' : '(marked paid)');
    } catch (err) {
      console.error('Webhook: could not mark order paid:', err.message);
      // Return 500 so Razorpay retries this delivery automatically —
      // it retries failed webhooks on a backoff schedule for a while.
      return res.status(500).json({ ok: false });
    }
  }

  // Always 200 for anything else (events we don't act on) — Razorpay
  // treats a non-2xx as "retry me," which we only want for real
  // processing failures above.
  res.json({ ok: true });
});

module.exports = router;
