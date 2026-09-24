const express = require('express');
const { appendRow, getRows } = require('../services/sheets.service');
const { sendEmail } = require('../services/mailer.service');
const { listCoupons } = require('../utils/coupons.util');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The welcome code is looked up from data/coupons.json (scope
// "first-order") instead of being hardcoded as "FIRST10" -- so if
// that code ever gets renamed or replaced in the admin's Coupons
// screen, both the on-page confirmation below and the (currently
// undeliverable, see below) welcome email automatically mention the
// current one instead of quietly pointing at a dead code.
function getWelcomeCoupon() {
  return listCoupons().find(c => c.scope === 'first-order' && c.active) || null;
}

function welcomeCouponLine(coupon) {
  if (!coupon) return 'Use code <strong>FIRST10</strong> for 10% off your first order.';
  return `Use code <strong>${coupon.code}</strong> for ${coupon.description}. Apply it in your cart before checkout -- it only works on your very first order.`;
}

router.post('/', async (req, res) => {
  const body = req.body || {};
  if (body.company) return res.json({ ok: true }); // honeypot

  const email = String(body.email || '').trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn\'t look right.' });
  }

  const coupon = getWelcomeCoupon();

  // Dedupe against the existing sheet before doing anything else. Two
  // reasons this matters, not just tidiness: (1) without it, the same
  // person resubmitting the form (or a bot hammering it) piles up
  // duplicate rows in the Newsletter sheet forever, and (2) it stops
  // us re-sending a "Welcome!" email to someone who already got one --
  // repeat sends to the same address are exactly the kind of pattern
  // that damages a mailbox's spam reputation, which matters a lot
  // right now since this is a brand-new mailbox still building trust
  // with inbox providers (see backend/README.md's SMTP section).
  let alreadySubscribed = false;
  try {
    const rows = await getRows('Newsletter');
    alreadySubscribed = rows.some(r => String(r[1] || '').trim().toLowerCase() === email.toLowerCase());
  } catch (err) {
    console.error('Sheets read failed (newsletter dedupe check):', err.message);
    // If the dedupe check itself fails, don't block the signup over
    // it -- worst case is one duplicate row, not a broken form.
  }

  if (!alreadySubscribed) {
    try {
      await appendRow('Newsletter', [new Date().toISOString(), email]);
    } catch (err) {
      console.error('Sheets append failed (newsletter):', err.message);
      return res.status(502).json({ ok: false, error: 'Could not save your subscription right now. Please try again shortly.' });
    }

    // Best-effort welcome email -- only for genuinely new subscribers
    // (see the dedupe comment above). A failure here shouldn't fail
    // the signup, since the address is already saved and the code is
    // ALSO returned directly below: the customer isn't left depending
    // on an email arriving to get their code.
    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to Brine & Shell: here\'s your 10% code',
        html: `<p>Thanks for subscribing! ${welcomeCouponLine(coupon)}</p>`,
      });
    } catch (err) {
      console.error('Email send failed (newsletter welcome):', err.message);
    }
  }

  // The coupon is returned whether this is a new or repeat signup, so
  // the form can show the code on the page immediately either way --
  // see index.html's handleNL(). null when no active first-order
  // coupon exists (shouldn't happen in normal operation).
  res.json({
    ok: true,
    alreadySubscribed,
    coupon: coupon ? { code: coupon.code, description: coupon.description } : null,
  });
});

module.exports = router;
