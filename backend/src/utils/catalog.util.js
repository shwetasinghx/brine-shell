/* =========================================
   Server-side view of the product catalog.
   Reads the SAME data/products.json the frontend fetches, so a price
   change only ever happens in one file. This is what makes it safe to
   trust an order total computed here instead of one sent by the
   browser.

   Delegates the actual file access to products.util.js, which reads
   the file fresh on every call instead of require()-ing it -- a
   plain require() caches the parsed JSON in memory forever, so an
   admin adding/editing a product (which writes this same file) would
   otherwise not be reflected here until the server restarted, and
   checkout would keep rejecting the new product as "Unknown product
   id" in the meantime. See products.util.js's own comment.
   ========================================= */
const { listProducts, getConfig } = require('./products.util');

function getProduct(id) {
  return listProducts().find(p => p.id === id);
}

/* items: [{ id, qty }] as sent by the browser (no prices trusted).
   Returns { lineItems, subtotal, deliveryFee, total } computed
   entirely from the server's own catalog. Throws on an unknown
   product id or a non-positive quantity. */
function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart is empty');
  }
  const config = getConfig();
  const lineItems = items.map(({ id, qty }) => {
    const product = getProduct(id);
    if (!product) throw new Error(`Unknown product id: ${id}`);
    const quantity = Number(qty);
    // Same 10-per-item cap the frontend enforces (data/products.json's
    // config.maxQtyPerItem — one number, read on both sides) so a
    // request that skips the browser's own limit still gets rejected
    // here. Falls back to 50 if the config is ever missing the key,
    // just as a hard upper bound rather than trusting an unbounded qty.
    const maxQty = config.maxQtyPerItem || 50;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > maxQty) {
      throw new Error(`Invalid quantity for ${id}: must be between 1 and ${maxQty}`);
    }
    return { id, name: product.name, price: product.price, qty: quantity, lineTotal: product.price * quantity };
  });
  const subtotal = lineItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const deliveryFee = subtotal >= config.freeDeliveryThreshold ? 0 : config.deliveryFee;
  return { lineItems, subtotal, deliveryFee, total: subtotal + deliveryFee, currency: config.currency };
}

module.exports = { getProduct, priceCart, get config() { return getConfig(); } };
