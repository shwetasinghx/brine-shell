/* =========================================
   Single source of truth for the Reviews sheet's column layout and
   valid values -- same "one shared file, not copy-pasted indices in
   every route" fix applied here from the start, instead of repeating
   the mistake that broke orders.js's return-status lookup (see
   returnsSchema.js).
   ========================================= */
const REVIEWS_COL = {
  timestamp: 0,
  orderId: 1,
  productId: 2,
  email: 3,
  name: 4,
  productRating: 5,
  deliverySpeed: 6,
  text: 7,
  status: 8,
  id: 9,
};

// A review needs a human to look at it before it's shown publicly --
// same reasoning as moderating return requests: it's a small brand's
// only public trust signal, so one fake or abusive review is worse
// than the extra step of approving real ones.
const REVIEW_STATUSES = ['Pending', 'Approved', 'Rejected'];

// Rating the delivery experience specifically (not just the product)
// is the whole point of this feature per how it was asked for --
// three plain options rather than another 5-star scale, since "was it
// fast or late" is what's actually being asked.
const DELIVERY_SPEEDS = ['Fast', 'On Time', 'Late'];

const REVIEW_TEXT_MAX_WORDS = 100;

module.exports = { REVIEWS_COL, REVIEW_STATUSES, DELIVERY_SPEEDS, REVIEW_TEXT_MAX_WORDS };
