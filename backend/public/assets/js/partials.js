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
  <div class="nav-notif" id="navNotif"></div>
  <div class="nav-auth" id="navAuth"></div>
  <button class="nav-toggle" id="navToggle" onclick="toggleMenu()" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileMenu">&#9776;</button>
</nav>
<div class="mobile-menu" id="mobileMenu">
  ${mobileLinks}
  <div class="mobile-notif" id="mobileNotif"></div>
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
      <div class="footer-social">
        <span class="footer-social-label">Follow us</span>
        <a href="https://www.instagram.com/buildingbrineandshell?utm_source=qr&stkn=aXE2aTJjNW9mNHMz" target="_blank" rel="noopener noreferrer" class="footer-social-icon" aria-label="Follow Brine & Shell on Instagram">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4.2" />
            <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </div>
      <div class="footer-social footer-whatsapp">
        <span class="footer-social-label">Chat with us</span>
        <a href="https://wa.me/918866360617?text=Hi%20Brine%20%26%20Shell%2C%20I%20have%20a%20question." target="_blank" rel="noopener noreferrer" class="footer-social-icon" aria-label="Chat with Brine & Shell on WhatsApp">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.07c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.13.11-1.82-.12-.42-.14-.96-.32-1.65-.63-2.9-1.25-4.8-4.16-4.94-4.35-.14-.19-1.19-1.58-1.19-3.02 0-1.43.75-2.14 1.02-2.43.27-.29.59-.36.79-.36.2 0 .4 0 .57.01.18.01.43-.07.67.51.24.58.83 2.01.9 2.16.07.15.12.32.02.51-.1.19-.15.31-.3.48-.15.17-.31.37-.44.5-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2.01 1.12.99 2.06 1.3 2.35 1.45.29.15.46.13.63-.05.17-.19.72-.84.92-1.13.19-.29.39-.24.65-.14.27.1 1.68.79 1.97.93.29.14.48.21.55.33.07.12.07.68-.17 1.34z" />
          </svg>
        </a>
      </div>
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
      <span class="footer-phone">+91 8866360617</span>
    </div>
  </div>
  <div class="footer-bottom">
    <p>© ${year} Brine &amp; Shell. All rights reserved. &nbsp;·&nbsp; <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a> · <a href="refund-policy.html">Refund Policy</a></p>
    <div class="footer-pay">
      <span class="footer-pay-label">Secured by <strong>Razorpay</strong></span>
      <span class="footer-pay-methods"><span>UPI</span><span>Cards</span><span>PhonePe</span><span>Google Pay</span></span>
    </div>
    <div class="dev-credit" id="devCredit">
      <button type="button" class="dev-credit-trigger" onclick="toggleDevCredit(event)"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDevCredit(event);}"
              aria-label="Website design and development enquiry">
        <span>Site design &amp; development</span>
      </button>
    </div>
  </div>
</footer>
<div class="dev-credit-overlay" id="devCreditOverlay" onclick="if(event.target===this) closeDevCredit()">
  <div class="dev-credit-card">
    <button type="button" class="dev-credit-close" onclick="closeDevCredit()" aria-label="Close">&#10005;</button>
    <p class="dev-credit-name">Shweta Singh</p>
    <p class="dev-credit-title">Software Development Engineer</p>
    <p class="dev-credit-tagline">Building technology, solving problems, and turning ideas into real-world experiences.</p>
    <p class="dev-credit-cta">Let's bring your ideas to life, one step closer to the dream.</p>
    <div class="dev-credit-email-row">
      <a href="mailto:shwetasingh0199@gmail.com" class="dev-credit-email">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="m3 6 9 6.5L21 6" />
        </svg>
        <span>shwetasingh0199@gmail.com</span>
      </a>
      <button type="button" class="dev-credit-copy" onclick="copyDevEmail(this)" aria-label="Copy email address">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
    <p class="dev-credit-signoff">Designed &amp; built with passion.</p>
  </div>
</div>`;
}

/* Opens/closes the developer-credit card as a centered overlay
   (same fixed-inset-backdrop pattern admin.html's confirm/product
   modals already use), rather than a corner-anchored dropdown --
   the trigger button lives at the far right edge of the footer, so
   anchoring the card TO the button (the earlier approach) still
   landed it near the page's right edge instead of actually centered.
   Centering on the viewport itself sidesteps that regardless of
   where the trigger sits. */
let devCreditTriggerEl = null;

/* Positions the card centered directly above whichever element
   triggered it (the footer button on desktop and mobile alike --
   this same footer markup is shared by every page, so there's only
   ever one trigger), computed from that element's real on-screen
   position rather than a fixed CSS offset, then clamped so the card
   can never spill past a screen edge the way the earlier
   right:0-anchored version did on narrow phones. The card is made
   visible BEFORE its width is measured (not after) specifically so
   `offsetWidth` reflects the width it will actually render at on
   that device -- .dev-credit-card's own `max-width: calc(100vw -
   40px)` shrinks it on narrow phones, and measuring while still
   display:none would always read 0 and silently fall back to the
   wrong (desktop) width. */
function positionDevCreditCard(triggerEl) {
  const overlay = document.getElementById('devCreditOverlay');
  const card = overlay?.querySelector('.dev-credit-card');
  if (!overlay || !card || !triggerEl) return;
  const rect = triggerEl.getBoundingClientRect();
  const cardWidth = card.offsetWidth || 290;
  const margin = 16;
  let left = rect.left + rect.width / 2 - cardWidth / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - cardWidth - margin));
  card.style.position = 'fixed';
  card.style.left = `${left}px`;
  card.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  card.style.top = 'auto';
}

function toggleDevCredit(e) {
  e.stopPropagation();
  devCreditTriggerEl = e.currentTarget;
  document.getElementById('devCreditOverlay')?.classList.add('open');
  positionDevCreditCard(devCreditTriggerEl);
}
function closeDevCredit() {
  document.getElementById('devCreditOverlay')?.classList.remove('open');
}
// Re-centers on the trigger if the viewport changes size/orientation
// while the card is open (e.g. rotating a phone) -- otherwise it
// would stay pinned to coordinates computed for the old layout.
window.addEventListener('resize', () => {
  if (document.getElementById('devCreditOverlay')?.classList.contains('open')) {
    positionDevCreditCard(devCreditTriggerEl);
  }
});

/* The mailto: link above already opens the visitor's default mail
   app directly -- this button is just a fallback for anyone without
   one configured (increasingly common), mirroring shop.html's own
   clipboard-copy pattern (navigator.clipboard, with a prompt()
   fallback for a browser/context where the Clipboard API is
   unavailable, e.g. no secure-context or permission denied). */
async function copyDevEmail(btn) {
  const email = 'shwetasingh0199@gmail.com';
  const original = btn.innerHTML;
  const showCopied = () => {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  };
  try {
    await navigator.clipboard.writeText(email);
    showCopied();
  } catch {
    prompt('Copy this email address:', email);
  }
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
