/* =========================================
   BRINE & SHELL — Shared Page Partials
   Single source of truth for the navbar and
   footer markup (previously copy-pasted into
   every page, which had already drifted —
   shop.html's footer had different columns
   from the other three pages). Also holds the
   nav/menu behavior that used to be duplicated
   in every page's inline <script> block.
   ========================================= */

const PRODUCT_LINK_FALLBACK = [
  'Peanut Butter Cubes', 'Dual Flavor Jar', 'Fuel Pack', 'Ceramic Jar',
];

function buildHeader(page) {
  const links = [
    { href: 'index.html', label: 'Home', key: 'home' },
    { href: 'shop.html', label: 'Shop', key: 'shop' },
    { href: 'about.html', label: 'About', key: 'about' },
    { href: 'contact.html', label: 'Contact', key: 'contact' },
  ];
  const navLinks = links.map(l =>
    `<li><a href="${l.href}"${l.key === page.active ? ' class="active"' : ''}>${l.label}</a></li>`
  ).join('');
  const mobileLinks = links.map(l => `<a href="${l.href}">${l.label}</a>`).join('');

  const cta = page.cartNav
    ? `<a href="shop.html" class="nav-cta">Cart <span class="nav-cart-badge" id="cartBadge">0</span></a>`
    : `<a href="shop.html" class="nav-cta">Shop Now</a>`;

  return `
<nav class="navbar" id="navbar">
  <a href="index.html" class="nav-logo">
    <img src="assets/images/brineandshell.png" width="44" height="44" alt="Brine & Shell logo" onerror="this.style.display='none'" />
    <span class="nav-logo-text">Brine <span class="amp">&amp;</span> Shell</span>
  </a>
  <ul class="nav-links">${navLinks}</ul>
  ${cta}
  <div class="nav-auth" id="navAuth"></div>
  <button class="nav-toggle" id="navToggle" onclick="toggleMenu()" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileMenu">&#9776;</button>
</nav>
<div class="mobile-menu" id="mobileMenu">
  ${mobileLinks}
  <div class="mobile-auth" id="mobileAuth"></div>
</div>`;
}

function buildFooter() {
  const productNames = (window.PRODUCTS || PRODUCT_LINK_FALLBACK.map(n => ({ name: n })))
    .map(p => `<a href="shop.html">${p.name}</a>`).join('');
  const year = new Date().getFullYear();

  return `
<footer class="footer">
  <div class="footer-top">
    <div class="footer-brand">
      <div class="footer-logo">
        <img src="assets/images/brineandshell.png" width="40" height="40" alt="Brine & Shell" onerror="this.style.display='none'" />
        <span>Brine <span class="amp">&amp;</span> Shell</span>
      </div>
      <p>Like Butter, But Better.<br />Made with love and real peanuts.</p>
    </div>
    <div class="footer-links">
      <h4>Quick Links</h4>
      <a href="index.html">Home</a><a href="shop.html">Shop</a><a href="about.html">About</a><a href="contact.html">Contact</a>
    </div>
    <div class="footer-links">
      <h4>Products</h4>
      ${productNames}
    </div>
    <div class="footer-links">
      <h4>Contact</h4>
      <a href="mailto:support@brineandshell.com">support@brineandshell.com</a>
      <a href="tel:+911234567890">+91 12345 67890</a>
      <p>Mon–Sat, 10am–6pm IST</p>
    </div>
  </div>
  <div class="footer-bottom">
    <p>© ${year} Brine &amp; Shell. All rights reserved. &nbsp;·&nbsp; <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a> · <a href="refund-policy.html">Refund Policy</a></p>
    <div class="footer-pay"><span>Secured by</span><strong>Razorpay</strong><span>| UPI · Cards · PhonePe · Google Pay</span></div>
  </div>
</footer>`;
}

function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  const btn = document.getElementById('navToggle');
  const open = menu.classList.toggle('open');
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

function initNavScroll() {
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
  });
}

/* Makes a FAQ-style accordion keyboard accessible: call once per
   trigger button with its answer panel's id. Works for any future
   accordion, not just the contact page FAQ. */
function initAccordionToggle(buttonEl, panelId) {
  const panel = document.getElementById(panelId);
  buttonEl.setAttribute('aria-expanded', 'false');
  buttonEl.setAttribute('aria-controls', panelId);
  buttonEl.addEventListener('click', () => {
    const open = buttonEl.parentElement.classList.toggle('open');
    buttonEl.setAttribute('aria-expanded', String(open));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for data/products.json (js/products.js) so the footer's
  // product links always reflect the real catalog, not the fallback.
  if (window.PRODUCTS_READY) await window.PRODUCTS_READY;
  const page = window.PAGE || {};
  const headerEl = document.getElementById('site-header');
  const footerEl = document.getElementById('site-footer');
  if (headerEl) headerEl.innerHTML = buildHeader(page);
  if (footerEl) footerEl.innerHTML = buildFooter();
  initNavScroll();
  document.dispatchEvent(new CustomEvent('partials:ready'));
});
