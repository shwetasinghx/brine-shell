/* =========================================
   Shared wishlist ("save for later") persistence — same pattern as
   js/cart.js: a plain array of product ids in localStorage, so it
   survives page reloads without needing an account or a backend.
   ========================================= */
const WISHLIST_STORAGE_KEY = 'bs_wishlist';

function getWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWishlist(list) {
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('Could not save wishlist:', err.message);
  }
  document.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { wishlist: list } }));
}

function isInWishlist(id) {
  return getWishlist().includes(id);
}

function addToWishlist(id) {
  const list = getWishlist();
  if (!list.includes(id)) {
    list.push(id);
    saveWishlist(list);
  }
}

function removeFromWishlist(id) {
  saveWishlist(getWishlist().filter(x => x !== id));
}
