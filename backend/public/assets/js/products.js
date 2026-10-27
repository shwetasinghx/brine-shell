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

/* Product photos. A product has `images` (1-5, first = cover) and `img`
   (always the cover, kept for older code paths and the cart thumbnail).
   Products saved before multi-photo support only have `img`. */
function productImages(p) {
  if (Array.isArray(p.images) && p.images.length) return p.images;
  return p.img ? [p.img] : [];
}

function renderProductImages(p) {
  const imgs = productImages(p);
  const alt = String(p.name).replace(/"/g, '&quot;');
  if (imgs.length <= 1) {
    return `<img src="${imgs[0] || ''}" alt="${alt}" width="600" height="600" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="ph" style="display:none"><p>${String(p.name).split(' ')[0]}</p></div>`;
  }
  // Swipe carousel: a CSS scroll-snap track (native touch swipe, no
  // library), prev/next arrows on hover-capable devices, and dots.
  return `<div class="pc-track">${imgs.map((src, i) =>
      `<img src="${src}" alt="${alt} - photo ${i + 1} of ${imgs.length}" width="600" height="600" loading="${i === 0 ? 'eager' : 'lazy'}" onerror="this.style.visibility='hidden'" />`).join('')}</div>
        <button type="button" class="pc-nav pc-prev" data-pc-dir="-1" aria-label="Previous photo" hidden>&#8249;</button>
        <button type="button" class="pc-nav pc-next" data-pc-dir="1" aria-label="Next photo">&#8250;</button>
        <div class="pc-dots" aria-hidden="true">${imgs.map((_, i) => `<span${i === 0 ? ' class="on"' : ''}></span>`).join('')}</div>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pc-nav');
  if (!btn) return;
  const track = btn.parentElement.querySelector('.pc-track');
  track.scrollBy({ left: Number(btn.dataset.pcDir) * track.clientWidth, behavior: 'smooth' });
});

// `scroll` doesn't bubble, so listen in the capture phase on document
// instead of wiring every track as cards are (re)rendered.
document.addEventListener('scroll', (e) => {
  const track = e.target;
  if (!track.classList || !track.classList.contains('pc-track')) return;
  const count = track.children.length;
  const idx = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
  const wrap = track.parentElement;
  wrap.querySelectorAll('.pc-dots span').forEach((d, i) => d.classList.toggle('on', i === idx));
  wrap.querySelector('.pc-prev').hidden = idx === 0;
  wrap.querySelector('.pc-next').hidden = idx === count - 1;
}, true);

/* ── SHARING ──
   One implementation for every page that shows product cards (home,
   shop) and the cart's "Share" link. The link is /p/<id>, served by the
   backend (share.controller.js) so chat apps get a per-product preview;
   it forwards to shop.html?product=<id>. Visitors need no account to
   browse -- they add to cart and sign in when they check out. */
const SHARE_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';

function renderShareButton(p) {
  const label = String(p.name).replace(/"/g, '&quot;');
  return `<button type="button" class="pc-share" onclick="shareProduct('${p.id}', this)" aria-label="Share ${label}" title="Share this product">${SHARE_ICON}</button>`;
}

function productShareUrl(p) {
  return `${location.origin}/p/${encodeURIComponent(p.id)}`;
}

function shareToast(message, tone) {
  if (typeof showToast === 'function') showToast(message, { tone: tone || 'success', duration: 3000 });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure contexts: select-and-copy fallback.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

let shareMenuEl = null;
function closeShareMenu() {
  if (shareMenuEl) { shareMenuEl.remove(); shareMenuEl = null; }
}

function openShareMenu(anchor, { url, text }) {
  closeShareMenu();
  const menu = document.createElement('div');
  menu.className = 'share-menu';
  menu.setAttribute('role', 'menu');
  const wa = `https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`;
  menu.innerHTML = `
    <a role="menuitem" href="${wa}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
    <button type="button" role="menuitem" data-share-copy>Copy link</button>`;
  document.body.appendChild(menu);
  shareMenuEl = menu;

  // Anchor under the button, clamped inside the viewport.
  const r = (anchor || document.body).getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  const top = r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  menu.addEventListener('click', async (e) => {
    if (e.target.closest('[data-share-copy]')) {
      const ok = await copyToClipboard(url);
      shareToast(ok ? 'Link copied. Paste it anywhere to share this product.' : 'Could not copy automatically. Long-press the address bar to copy the link.', ok ? 'success' : 'info');
    }
    closeShareMenu();
  });
}
document.addEventListener('click', (e) => {
  if (shareMenuEl && !shareMenuEl.contains(e.target) && !e.target.closest('.pc-share, [data-share-trigger]')) closeShareMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShareMenu(); });
window.addEventListener('resize', closeShareMenu);
window.addEventListener('scroll', closeShareMenu, { passive: true });

/* Native share sheet where the browser offers one (most phones);
   otherwise a small menu with WhatsApp + Copy link. */
async function shareProduct(id, anchor) {
  const p = (window.PRODUCTS || []).find(x => x.id === id);
  if (!p) return;
  const url = productShareUrl(p);
  const text = `${p.name} (${p.wt}) – ₹${p.price} on Brine & Shell`;
  if (navigator.share) {
    try { await navigator.share({ title: `${p.name} | Brine & Shell`, text, url }); } catch { /* cancelled -- not an error */ }
    return;
  }
  openShareMenu(anchor, { url, text });
}

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
      <div class="pc-img${productImages(p).length > 1 ? ' has-multi' : ''}">
        ${renderProductImages(p)}
        ${p.badge ? `<span class="pc-badge ${p.bc}">${p.badge}</span>` : ''}
      </div>
      <div class="pc-body">
        <div class="pc-title-row"><h3>${p.name}</h3>${renderShareButton(p)}</div>
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
