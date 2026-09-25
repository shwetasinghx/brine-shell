/* =========================================
   Coupon codes: shared read/write layer.

   data/coupons.json is the one true coupon list -- same pattern as
   products.util.js next to it: read fresh from disk on every call
   (never require()'d, which would cache the parsed JSON forever and
   hide an admin's edit until the process restarted), writes
   serialized through a promise-chain queue since there's one admin
   editing occasionally, not concurrent writers.

   This module only knows coupon RULES (percent/flat, active window,
   minimum order, scope). It deliberately does NOT know how to check
   "has this account ordered before" -- that needs the Orders Google
   Sheet, which lives in sheets.service.js, and pulling that dependency
   in here would mean this module (and the admin CRUD screen built on
   it) fails to even load a coupon list if Sheets isn't configured.
   The "first order only" check is done by the caller (see
   coupons.controller.js's validateCoupon) using getRows('Orders').
   ========================================= */
const fs = require('fs');
const path = require('path');
const { getRows } = require('../services/sheets.service');

const COUPONS_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'coupons.json');

const VALID_TYPES = ['percent', 'flat'];
const VALID_SCOPES = ['general', 'first-order'];

// Same Orders sheet layout every other controller that reads this
// sheet uses (checkout.controller.js, orders.controller.js,
// admin.controller.js) -- only the two columns this check needs are
// named here rather than importing that whole COL map.
const ORDERS_COL = { paymentStatus: 2, accountEmail: 10 };

function readCoupons() {
  const raw = fs.readFileSync(COUPONS_PATH, 'utf8');
  return JSON.parse(raw);
}

let writeQueue = Promise.resolve();
function withCoupons(mutate) {
  const result = writeQueue.then(async () => {
    const data = readCoupons();
    const { data: next, returnValue } = await mutate(data);
    if (next) {
      fs.writeFileSync(COUPONS_PATH, JSON.stringify(next, null, 2) + '\n');
    }
    return returnValue;
  });
  writeQueue = result.catch(() => {});
  return result;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function listCoupons() {
  return readCoupons().coupons;
}

function getCouponByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return readCoupons().coupons.find(c => c.code === normalized) || null;
}

/* A coupon can exist and still not be usable right now: `active` is
   the admin's own on/off switch (instant, no need to delete a
   festival code the day after the festival ends -- just flip it
   off, or leave the date window to handle it automatically), and
   startDate/endDate (either or both may be null, meaning no bound
   on that side) gate it to an actual calendar window for a seasonal
   code. `now` is injectable so tests don't depend on the real clock. */
function isCouponWindowOpen(coupon, now = new Date()) {
  if (!coupon || !coupon.active) return false;
  if (coupon.startDate && now < new Date(`${coupon.startDate}T00:00:00`)) return false;
  if (coupon.endDate && now > new Date(`${coupon.endDate}T23:59:59`)) return false;
  return true;
}

/* Discount in rupees for a given subtotal, honoring an optional
   maxDiscount cap (keeps a big percentage code from taking an
   unbounded chunk off a very large order) and never exceeding the
   subtotal itself (a flat-amount code on a tiny cart shouldn't be
   able to make the total negative). Mirrors the same formula shop.html
   keeps client-side for the live cart preview -- see that file's
   `computeCouponDiscount()` -- so the number a customer sees in their
   cart matches what checkout actually charges; checkout still
   recomputes this itself server-side rather than trusting the browser. */
function computeDiscount(coupon, subtotal) {
  if (!coupon || subtotal <= 0) return 0;
  let discount = coupon.type === 'percent'
    ? Math.round((subtotal * coupon.value) / 100)
    : coupon.value;
  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal));
}

function validateCouponFields(body) {
  const code = normalizeCode(body?.code);
  const label = String(body?.label || '').trim();
  const description = String(body?.description || '').trim();
  const type = body?.type;
  const value = Number(body?.value);
  const scope = body?.scope;
  const minOrder = body?.minOrder === '' || body?.minOrder == null ? 0 : Number(body.minOrder);
  const maxDiscount = body?.maxDiscount === '' || body?.maxDiscount == null ? null : Number(body.maxDiscount);
  const startDate = body?.startDate || null;
  const endDate = body?.endDate || null;

  if (!code) return 'Please enter a code.';
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return 'Codes must be 3-20 letters/numbers, no spaces or symbols.';
  if (!label) return 'Please enter a short label (e.g. "Diwali").';
  if (!description) return 'Please enter a customer-facing description.';
  if (!VALID_TYPES.includes(type)) return 'Choose a discount type.';
  if (!Number.isFinite(value) || value <= 0) return 'Please enter a valid discount value.';
  if (type === 'percent' && value > 90) return 'Percentage discounts above 90% are not allowed.';
  if (!VALID_SCOPES.includes(scope)) return 'Choose who this code applies to.';
  if (!Number.isFinite(minOrder) || minOrder < 0) return 'Minimum order must be 0 or more.';
  if (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) return 'Max discount must be a positive number, or left blank.';
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) return 'The start date must be before the end date.';

  return null;
}

function buildCouponRecord(body) {
  return {
    code: normalizeCode(body.code),
    label: String(body.label || '').trim(),
    description: String(body.description || '').trim(),
    type: body.type,
    value: Number(body.value),
    scope: body.scope,
    active: body.active !== false && body.active !== 'false',
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    minOrder: body.minOrder === '' || body.minOrder == null ? 0 : Number(body.minOrder),
    maxDiscount: body.maxDiscount === '' || body.maxDiscount == null ? null : Number(body.maxDiscount),
  };
}

// Returns the coupon, or null if that code already exists (codes are
// the natural unique key here -- there's no separate id).
function addCoupon(body) {
  return withCoupons(data => {
    const code = normalizeCode(body.code);
    if (data.coupons.some(c => c.code === code)) {
      return { data: null, returnValue: null };
    }
    const coupon = buildCouponRecord(body);
    data.coupons.push(coupon);
    return { data, returnValue: coupon };
  });
}

// Renaming the code itself is allowed (e.g. fixing a typo before it's
// ever been shared) as long as the new code doesn't collide with a
// different existing one.
function updateCoupon(originalCode, body) {
  return withCoupons(data => {
    const original = normalizeCode(originalCode);
    const idx = data.coupons.findIndex(c => c.code === original);
    if (idx === -1) return { data: null, returnValue: null };
    const nextCode = normalizeCode(body.code);
    if (nextCode !== original && data.coupons.some(c => c.code === nextCode)) {
      return { data: null, returnValue: 'duplicate' };
    }
    const coupon = buildCouponRecord(body);
    data.coupons[idx] = coupon;
    return { data, returnValue: coupon };
  });
}

function deleteCoupon(code) {
  return withCoupons(data => {
    const normalized = normalizeCode(code);
    const idx = data.coupons.findIndex(c => c.code === normalized);
    if (idx === -1) return { data: null, returnValue: null };
    const [removed] = data.coupons.splice(idx, 1);
    return { data, returnValue: removed };
  });
}

/* "Has this account ever completed a PAID order?" -- the actual
   enforcement behind a scope:"first-order" coupon like FIRST10.
   Matches on Account Email (Pass 4's column, always the verified
   signed-in email, never the freely-editable contact email) so a
   customer can't dodge this by typing a different contact email at
   checkout. A Sheets failure (e.g. not configured yet) is allowed to
   bubble up rather than silently treated as "no prior order" --
   swallowing it here would let the restriction be bypassed simply by
   breaking the Sheets connection. */
async function hasPriorPaidOrder(accountEmail) {
  const email = String(accountEmail || '').toLowerCase();
  if (!email) return false;
  const rows = await getRows('Orders');
  return rows.slice(1).some(r =>
    String(r[ORDERS_COL.accountEmail] || '').toLowerCase() === email &&
    r[ORDERS_COL.paymentStatus] === 'paid'
  );
}

/* The single place a coupon code is judged valid or not, called from
   BOTH the cart's "Apply" preview (coupons.controller.js) and
   checkout's create-order (checkout.controller.js) -- so a code that
   passes the cart preview can never behave differently at the point
   money actually moves. `subtotal` is the CALLER's already
   server-priced cart total (catalog.util's priceCart), never a number
   from the browser. Returns { ok:true, coupon, discount } or
   { ok:false, status, error }. */
async function validateCoupon({ code, subtotal, accountEmail }) {
  const coupon = getCouponByCode(code);
  if (!coupon) return { ok: false, status: 404, error: 'That code isn\'t valid.' };
  if (!isCouponWindowOpen(coupon)) {
    return { ok: false, status: 400, error: 'That code isn\'t active right now.' };
  }
  if (subtotal < coupon.minOrder) {
    return { ok: false, status: 400, error: `Add ₹${coupon.minOrder - subtotal} more to your cart to use this code.` };
  }
  if (coupon.scope === 'first-order') {
    if (!accountEmail) {
      return { ok: false, status: 401, error: 'Please sign in to use this code.' };
    }
    if (await hasPriorPaidOrder(accountEmail)) {
      return { ok: false, status: 400, error: 'This code is only valid on your first order -- looks like you\'ve already placed one.' };
    }
  }
  return { ok: true, coupon, discount: computeDiscount(coupon, subtotal) };
}

module.exports = {
  listCoupons,
  getCouponByCode,
  isCouponWindowOpen,
  computeDiscount,
  validateCouponFields,
  validateCoupon,
  addCoupon,
  updateCoupon,
  deleteCoupon,
  normalizeCode,
  VALID_TYPES,
  VALID_SCOPES,
};
