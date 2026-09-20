/* =========================================
   Single source of truth for the Returns sheet's column layout and
   valid statuses.

   Before this file existed, the same column numbers were copy-pasted
   as literal indices in admin.js, returns.js, AND orders.js. When
   Return ID and Video URL were appended as new trailing columns
   (instead of the old, broken front-insertion layout -- see
   backend/README.md), admin.js and returns.js were updated, but
   orders.js's copy was missed. It kept reading Order ID from index 2
   and Status from index 6 -- the OLD layout -- so every lookup
   silently matched nothing, and the customer-facing "waiting for
   approval / approved / cancelled" banner on orders.html never showed
   for anyone. Importing from here instead of re-deriving the numbers
   is what prevents that from happening again.
   ========================================= */
const RETURNS_COL = {
  timestamp: 0,
  orderId: 1,
  email: 2,
  items: 3,
  reason: 4,
  status: 5,
  imageUrl: 6,
  id: 7,
  videoUrl: 8,
  challenge: 9,
};

const RETURN_STATUSES = ['Requested', 'Approved', 'Cancelled'];

module.exports = { RETURNS_COL, RETURN_STATUSES };
