/* =========================================
   BRINE & SHELL — Product Catalog Loader
   Single source of truth is data/products.json,
   which this file loads AND which the backend
   (backend/server.js) reads directly on the
   server for price verification. Never hardcode
   prices/descriptions here or in any page again —
   edit data/products.json instead.
   ========================================= */

window.PRODUCTS = [];
window.SITE_CONFIG = {};

window.PRODUCTS_READY = fetch('data/products.json')
  .then(res => {
    if (!res.ok) throw new Error('Failed to load product catalog: ' + res.status);
    return res.json();
  })
  .then(data => {
    window.PRODUCTS = data.products;
    window.SITE_CONFIG = data.config;
    document.querySelectorAll('[data-fd-amount]').forEach(el => {
      el.textContent = '₹' + SITE_CONFIG.freeDeliveryThreshold;
    });
    document.querySelectorAll('[data-fd-fee]').forEach(el => {
      el.textContent = '₹' + SITE_CONFIG.deliveryFee;
    });
    return window.PRODUCTS;
  })
  .catch(err => {
    console.error(err);
    return [];
  });

/* Preview cards used on the homepage -- same copy/pricing as the shop
   page (one catalog, data/products.json) but a simpler footer: a real
   "Add to Cart" button (backed by the same shared cart in js/cart.js,
   so it's the same cart shop.html's drawer shows) rather than the
   quantity stepper shop.html has room for, plus a "View in Shop" link
   for anyone who wants the full picker/stepper experience. */
function renderProductPreviewCards(containerId, products) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = products.map(p => `
    <div class="product-card">
      <div class="pc-img">
        <img src="${p.img}" alt="${p.name}" width="600" height="600" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="ph" style="display:none"><p>${p.name.split(' ')[0]}</p></div>
        ${p.badge ? `<span class="pc-badge ${p.bc}">${p.badge}</span>` : ''}
      </div>
      <div class="pc-body">
        <h3>${p.name}</h3>
        <p class="wt">${p.wt}</p>
        <p>${p.desc}</p>
        <div class="pc-footer">
          <span class="price">₹${p.price}</span>
          <button class="btn-sm" id="home-atc-${p.id}" onclick="addFromHome('${p.id}')">Add to Cart</button>
        </div>
      </div>
    </div>`).join('');
}

/* Adds straight into the shared cart (js/cart.js) from the homepage,
   with a brief "Added" confirmation on the button itself since this
   page has no cart drawer open to glance at -- the nav badge (synced
   by cart.js) is the other cue that it worked. */
function addFromHome(id) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);

  const btn = document.getElementById(`home-atc-${id}`);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = 'Added ✓';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1200);
}
