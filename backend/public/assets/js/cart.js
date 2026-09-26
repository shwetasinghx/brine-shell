/* =========================================
   Shared cart persistence.
   The cart used to be a plain in-memory variable inside shop.html's
   own script — meaning it reset itself on every full page load,
   including clicking the "Cart" button in the nav (a link to
   shop.html, which forces a fresh page load even when you're
   already there). Storing it in localStorage instead makes the cart
   survive reloads and navigating away and back: one durable source
   of truth, the same principle behind using a Sheet for orders and
   a session cookie for sign-in — just backed by the browser here,
   since a cart is per-device, not tied to an account.
   ========================================= */
const CART_STORAGE_KEY = 'bs_cart';

function getCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (err) {
    console.error('Could not save cart:', err.message);
  }
  document.dispatchEvent(new CustomEvent('cart:changed', { detail: { cart } }));
}

function getCartCount(cart) {
  const source = cart || getCart();
  return Object.values(source).reduce((sum, q) => sum + (Number(q) || 0), 0);
}

/* Keeps the nav's cart badge (id="cartBadge") in sync wherever it
   exists. shop.html's own renderCart() also touches the badge as
   part of drawing the full cart drawer -- that's harmless overlap.
   This is what makes the badge work on pages (like the homepage)
   that show a live count but have no drawer of their own. The badge
   itself only renders in the header when a page sets cartNav:true
   (js/partials.js), and it's injected after partials.js builds the
   header, hence syncing again on 'partials:ready'. */
function syncCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = count;
  badge.style.display = count ? 'inline' : 'none';
}
document.addEventListener('cart:changed', syncCartBadge);
document.addEventListener('partials:ready', syncCartBadge);

/* The single per-item quantity cap, shared by shop.html's cart drawer
   and the homepage preview cards, and mirrored server-side in
   catalog.util.js. Reads data/products.json's config.maxQtyPerItem
   (loaded into window.SITE_CONFIG by js/products.js) so the number
   only ever lives in one file; the 10 here is just a fallback for the
   brief window before that fetch resolves. */
function getMaxQtyPerItem() {
  return (window.SITE_CONFIG && SITE_CONFIG.maxQtyPerItem) || 10;
}

/* Shared toast, used by both shop.html (order placed, coupon errors,
   cart-pruning notices) and the homepage (quantity-limit notices).
   Every page that calls showToast() needs a bare `<div id="toast">`
   somewhere in its body -- see index.html/shop.html. One
   implementation here instead of two copies drifting apart. */
let toastTimer = null;
function showToast(message, { tone = 'success', duration = 4500 } = {}) {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = message;
  t.classList.toggle('toast-info', tone === 'info');
  t.style.display = 'block';
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, duration);
}
