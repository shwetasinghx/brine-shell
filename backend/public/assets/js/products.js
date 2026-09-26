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
   page (one catalog, data/products.json) AND now the same quantity
   stepper shop.html's cards use, backed by the same shared cart
   (js/cart.js). It used to show a real "Add to Cart" button that
   flashed "Added \u2713" and then reverted back to "Add to Cart" --
   which quietly lied about the cart's actual state: a second click
   added a second unit with no visible sign anything had changed. The
   stepper is the honest version of the same state shop.html already
   renders, just reached from a different page. */
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
          <div class="qty-ctrl" id="home-qc-${p.id}" style="display:none">
            <button class="qty-btn" onclick="changeFromHome('${p.id}',-1)" aria-label="Decrease quantity">−</button>
            <span class="qty-num" id="home-qn-${p.id}">0</span>
            <button class="qty-btn" onclick="changeFromHome('${p.id}',1)" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn-sm" id="home-atc-${p.id}" onclick="addFromHome('${p.id}')">Add to Cart</button>
        </div>
      </div>
    </div>`).join('');
}

/* Adds straight into the shared cart (js/cart.js) from the homepage,
   then swaps the button for the quantity stepper -- same transition
   shop.html's own add() does, so both pages read as one system
   instead of two different cart behaviors. */
function addFromHome(id) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);
  const qn = document.getElementById(`home-qn-${id}`);
  const atc = document.getElementById(`home-atc-${id}`);
  const qc = document.getElementById(`home-qc-${id}`);
  if (qn) qn.textContent = cart[id];
  if (atc) atc.style.display = 'none';
  if (qc) qc.style.display = 'flex';
}

/* The homepage's version of shop.html's chg() -- same 10-per-item cap
   (data/products.json's config.maxQtyPerItem, read through
   getMaxQtyPerItem() in js/cart.js) and the same toast when a
   customer tries to go over it, so hitting the limit looks and
   behaves identically no matter which page they're adding from. */
function changeFromHome(id, d) {
  const cart = getCart();
  const max = getMaxQtyPerItem();
  const current = cart[id] || 0;
  if (d > 0 && current >= max) {
    showToast(`Max ${max} per order. Need more? Email or WhatsApp us.`, { tone: 'info' });
    return;
  }
  const next = Math.min(Math.max(0, current + d), max);
  cart[id] = next;
  saveCart(cart);
  const qn = document.getElementById(`home-qn-${id}`);
  const atc = document.getElementById(`home-atc-${id}`);
  const qc = document.getElementById(`home-qc-${id}`);
  if (qn) qn.textContent = next;
  if (next === 0) {
    if (atc) atc.style.display = '';
    if (qc) qc.style.display = 'none';
  }
}

/* Reflects cart state that already existed before this page rendered
   -- added from shop.html earlier, or from the homepage on a previous
   visit -- so a returning customer sees the real stepper instead of a
   misleading blank "Add to Cart". Mirrors shop.html's syncCartUI(). */
function syncHomeCartUI() {
  const cart = getCart();
  Object.entries(cart).forEach(([id, q]) => {
    if (q > 0) {
      const qn = document.getElementById(`home-qn-${id}`);
      const atc = document.getElementById(`home-atc-${id}`);
      const qc = document.getElementById(`home-qc-${id}`);
      if (qn) qn.textContent = q;
      if (atc) atc.style.display = 'none';
      if (qc) qc.style.display = 'flex';
    }
  });
}
