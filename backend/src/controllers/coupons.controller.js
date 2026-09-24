const express = require('express');
const { priceCart } = require('../utils/catalog.util');
const { validateCoupon, listCoupons, isCouponWindowOpen } = require('../utils/coupons.util');
const { requireAuth } = require('../utils/auth.util');

const router = express.Router();

/* Cart-side preview: browser sends the same { items:[{id,qty}] } shape
   checkout uses, plus the code typed into the "Apply" box. Requires
   sign-in (checkout requires it for everyone anyway -- see Pass 8 --
   so this never promises a discount an anonymous visitor couldn't
   actually complete), and doubles as basic rate-limiting for anyone
   trying to guess codes: requireAuth means a would-be guesser needs a
   real Google account per attempt, not just requests.

   The actual truth-telling happens in coupons.util's validateCoupon,
   which checkout.controller.js's /create-order calls again with the
   final cart at the moment of payment -- so nothing this route
   returns is ever trusted on its own for what a customer is charged. */
/* Public list of codes worth showing in the cart's promo dropdown --
   no sign-in required, since a signed-out visitor should still be
   able to see what offers exist before they sign in to use one. Only
   returns codes that are active AND currently inside their date
   window; a "first order only" code is still listed here even for a
   returning customer (we can't know their order history without a
   session), and applying it correctly gets rejected server-side by
   validateCoupon() with a clear message -- same "list is a preview,
   /apply is the real check" split the rest of this file already
   uses. Never leaks internal-only fields like minOrder here since the
   dropdown doesn't need them; /apply already enforces minOrder for
   real when the code is actually applied. */
router.get('/available', (req, res) => {
  const coupons = listCoupons()
    .filter(c => c.active && isCouponWindowOpen(c))
    .map(c => ({
      code: c.code,
      label: c.label,
      description: c.description,
      type: c.type,
      value: c.value,
      scope: c.scope,
      maxDiscount: c.maxDiscount,
    }));
  res.json({ ok: true, coupons });
});

router.post('/apply', requireAuth, async (req, res) => {
  const { code, items } = req.body || {};

  let priced;
  try {
    priced = priceCart(items);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  let result;
  try {
    result = await validateCoupon({ code, subtotal: priced.subtotal, accountEmail: req.user.email });
  } catch (err) {
    console.error('Coupon validation failed:', err.message);
    return res.status(502).json({ ok: false, error: 'Could not check that code right now. Please try again shortly.' });
  }
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });

  const { coupon, discount } = result;
  res.json({
    ok: true,
    code: coupon.code,
    label: coupon.label,
    description: coupon.description,
    type: coupon.type,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    discount,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    total: Math.max(0, priced.subtotal - discount) + priced.deliveryFee,
  });
});

module.exports = router;
