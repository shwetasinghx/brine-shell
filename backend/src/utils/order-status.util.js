/* =========================================
   The four fulfillment stages an order moves through, plus one
   terminal state that sits outside that progression: "Cancelled" --
   used when an order can't be fulfilled at all (e.g. the delivery
   location turns out to be too far), rather than one more step on
   the way to delivery. Kept here as the one backend source of truth
   (admin route validates against this list). The frontend
   (orders.html) renders the same four stage labels for the stepper
   UI, and treats Cancelled as its own case rather than a stepper
   step -- if you ever change these, update both places.
   ========================================= */
const STAGES = ['Order Placed', 'Shipped', 'Out for Delivery', 'Delivered'];
const CANCELLED = 'Cancelled';
const ALL_STATUSES = [...STAGES, CANCELLED];

function stageIndex(status) {
  return STAGES.indexOf(status);
}

module.exports = { STAGES, CANCELLED, ALL_STATUSES, stageIndex };
