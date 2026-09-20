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
