/* =========================================
   Product catalog: shared read/write layer.

   data/products.json is the one true catalog (see catalog.util.js's
   own comment) -- both the storefront (fetch) and the backend
   (price verification, reviews, and now this admin CRUD) read it.
   Writing here is what lets an admin's product change show up on the
   shop page immediately, with no deploy or restart.

   Deliberately NOT using require() to read the file: require() caches
   a JSON module in memory the first time it's loaded, so a second
   require() of the same path -- even after this module rewrites the
   file on disk -- would keep returning the stale, pre-edit catalog
   for the lifetime of the process. Reading with fs + JSON.parse on
   every call avoids that entirely; the file is a few KB, so there's
   no real cost to skipping an in-memory cache.

   Writes are serialized through a simple promise chain (`writeQueue`)
   rather than a real file lock -- there's one admin, editing the
   catalog occasionally, not concurrent writers, so this just protects
   against two nearly-simultaneous admin requests interleaving their
   read-modify-write and corrupting the file.
   ========================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'products.json');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'images', 'products');
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const VALID_BADGES = {
  '': { badge: null, bc: '' },
  'Bestseller': { badge: 'Bestseller', bc: 'badge-default' },
  'New': { badge: 'New', bc: 'badge-new' },
  'Premium': { badge: 'Premium', bc: 'badge-premium' },
};

function readCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  return JSON.parse(raw);
}

let writeQueue = Promise.resolve();
// Every write goes through the *same* promise chain, so a write that
// starts while another is still in flight waits its turn instead of
// racing it -- `mutate` gets the freshest catalog (read right before
// its own turn runs, not whenever the caller happened to call this)
// and returns whatever it wants handed back to the original caller.
function withCatalog(mutate) {
  const result = writeQueue.then(async () => {
    const catalog = readCatalog();
    const { catalog: next, returnValue } = await mutate(catalog);
    if (next) {
      fs.writeFileSync(CATALOG_PATH, JSON.stringify(next, null, 2) + '\n');
    }
    return returnValue;
  });
  // Keep the queue alive even if this particular write rejects --
  // otherwise one failed edit would wedge every edit after it.
  writeQueue = result.catch(() => {});
  return result;
}

// "Peanut Butter Cubes" -> "peanut-butter-cubes"; falls back to a
// timestamp if the name has no ASCII letters/digits at all (e.g.
// emoji-only input) so there's always a usable id.
function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `product-${Date.now()}`;
}

function uniqueId(catalog, name) {
  const base = slugify(name);
  let id = base;
  let n = 2;
  const existing = new Set(catalog.products.map(p => p.id));
  while (existing.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// Comma-separated free text -> a clean, de-duplicated tag list, e.g.
// "High Protein, High Protein, Vegan" -> ["High Protein", "Vegan"].
function parseTags(raw) {
  const seen = new Set();
  const tags = [];
  String(raw || '').split(',').forEach(t => {
    const tag = t.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  });
  return tags;
}

function badgeFields(badgeInput) {
  const key = VALID_BADGES[badgeInput] ? badgeInput : '';
  return VALID_BADGES[key];
}

function listProducts() {
  return readCatalog().products;
}

function getConfig() {
  return readCatalog().config;
}

function getProductById(id) {
  return readCatalog().products.find(p => p.id === id) || null;
}

// `input`: { name, price, wt, desc, tags (raw string), badge, imgPath (already-saved relative path) }
function addProduct(input) {
  return withCatalog(catalog => {
    const id = uniqueId(catalog, input.name);
    const product = {
      id,
      name: String(input.name || '').trim(),
      price: Number(input.price),
      wt: String(input.wt || '').trim(),
      ...badgeFields(input.badge),
      img: input.imgPath,
      tags: parseTags(input.tags),
      desc: String(input.desc || '').trim(),
    };
    catalog.products.push(product);
    return { catalog, returnValue: product };
  });
}

// `updates` may omit `imgPath` to leave the existing image untouched.
function updateProduct(id, updates) {
  return withCatalog(catalog => {
    const idx = catalog.products.findIndex(p => p.id === id);
    if (idx === -1) return { catalog: null, returnValue: null };
    const existing = catalog.products[idx];
    const oldImagePath = existing.img;
    const product = {
      ...existing,
      name: String(updates.name || '').trim(),
      price: Number(updates.price),
      wt: String(updates.wt || '').trim(),
      ...badgeFields(updates.badge),
      img: updates.imgPath || existing.img,
      tags: parseTags(updates.tags),
      desc: String(updates.desc || '').trim(),
    };
    catalog.products[idx] = product;
    return { catalog, returnValue: { product, oldImagePath: updates.imgPath ? oldImagePath : null } };
  });
}

function deleteProduct(id) {
  return withCatalog(catalog => {
    const idx = catalog.products.findIndex(p => p.id === id);
    if (idx === -1) return { catalog: null, returnValue: null };
    const [removed] = catalog.products.splice(idx, 1);
    return { catalog, returnValue: removed };
  });
}

// Only ever deletes a file this module's own upload handler saved
// (inside assets/images/products/) -- never touches the four
// original, hand-placed catalog photos in assets/images/ directly,
// even if a product's `img` somehow still pointed at one of those.
function deleteProductImage(imgRelativePath) {
  if (!imgRelativePath) return;
  const normalized = imgRelativePath.replace(/^\/+/, '');
  if (!normalized.startsWith('assets/images/products/')) return;
  const absolute = path.join(__dirname, '..', '..', 'public', normalized);
  fs.unlink(absolute, (err) => {
    // ENOENT (already gone) is fine and expected -- anything else
    // (e.g. a permissions problem on the host) is worth knowing about
    // even though it's not worth failing the request over: the
    // product record is already saved/updated by this point, and an
    // orphaned image file is a disk-space annoyance, not data loss.
    if (err && err.code !== 'ENOENT') {
      console.error(`Could not delete old product image (${absolute}):`, err.message);
    }
  });
}

module.exports = {
  IMAGES_DIR,
  listProducts,
  getProductById,
  addProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  getConfig,
  VALID_BADGES,
};
