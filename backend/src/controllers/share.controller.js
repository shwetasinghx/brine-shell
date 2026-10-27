/* Share landing page for a single product: GET /p/:id

   Why a server route instead of just linking to shop.html?product=<id>:
   WhatsApp, iMessage, Facebook, X, etc. build their link preview by
   fetching the URL and reading its <meta property="og:*"> tags -- they
   never run JavaScript. shop.html is one static page for every
   product, so its preview would always be the generic shop card. This
   route returns a tiny page whose tags describe *this* product (name,
   price, cover photo), and which immediately forwards a real visitor
   to shop.html?product=<id>, where the shop page scrolls to and
   highlights that product. From there the visitor uses the normal
   add-to-cart -> sign in at checkout -> pay flow, so there is no
   separate "shared order" path to keep correct.

   Safety notes: the product is looked up by id in the catalog and only
   catalog values are ever written into the page (never the raw URL
   parameter), and every value is HTML-escaped. An unknown id just
   redirects to the shop. */

const { listProducts, imagesOf } = require('../utils/products.util');
const { allowedOrigin } = require('../config/app.config');

const SITE_NAME = 'Brine & Shell';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Absolute URLs are required in og:* tags. The configured site origin is
// used (not the request's Host header) so a spoofed Host can't make us
// emit links to another domain.
function siteBase() {
  return String(allowedOrigin).split(',')[0].trim().replace(/\/+$/, '');
}

function absoluteUrl(base, p) {
  if (/^https?:\/\//i.test(p)) return p;
  return `${base}/${encodeURI(String(p).replace(/^\/+/, ''))}`;
}

function truncate(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function shareLanding(req, res) {
  const product = listProducts().find(p => p.id === req.params.id);
  if (!product) return res.redirect(302, '/shop.html');

  const base = siteBase();
  const target = `/shop.html?product=${encodeURIComponent(product.id)}`;
  const title = `${product.name} | ${SITE_NAME}`;
  const description = truncate(`₹${product.price} · ${product.wt}. ${product.desc}`, 200);
  const cover = imagesOf(product)[0];
  const image = cover ? absoluteUrl(base, cover) : absoluteUrl(base, 'assets/images/brineandshell.png');
  const pageUrl = `${base}/p/${encodeURIComponent(product.id)}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="noindex" />
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
</head>
<body>
<p><a href="${escapeHtml(target)}">Continue to ${escapeHtml(product.name)} on ${SITE_NAME}</a></p>
</body>
</html>`;

  // Short public cache: previews get fetched in bursts when a link is
  // pasted into a busy chat, but price/photo edits should show up soon.
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(html);
}

module.exports = { shareLanding };
