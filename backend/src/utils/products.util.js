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

// Max photos per product -- the one place this number lives; the
// admin API hands it to the form so the UI limit can't drift.
const MAX_PRODUCT_IMAGES = 5;

// A product's photos, cover first. Products saved before multi-photo
// support only have `img`, so fall back to that -- every consumer
// (shop cards, admin, cart, orders) keeps working on old records.
function imagesOf(product) {
  if (Array.isArray(product?.images) && product.images.length) return product.images;
  return product?.img ? [product.img] : [];
}

/* Builds the final ordered photo list for a save.
   `order` is an array of tokens from the admin form, in the order the
   admin arranged them (first = cover): either an EXISTING photo's
   path, or "new:N" meaning the Nth freshly uploaded file.
   `existing` = the product's current photos (empty for a new
   product), `newPaths` = relative paths of the files just saved.
   Existing tokens must already belong to this product -- that stops
   a crafted request from pointing a product at some other file. */
function resolveImageOrder(existing, order, newPaths) {
  if (!Array.isArray(order) || order.length === 0) {
    const err = new Error('Please add at least one product photo.');
    err.code = 'BAD_IMAGES';
    throw err;
  }
  if (order.length > MAX_PRODUCT_IMAGES) {
    const err = new Error(`A product can have at most ${MAX_PRODUCT_IMAGES} photos.`);
    err.code = 'BAD_IMAGES';
    throw err;
  }
  const seen = new Set();
  return order.map(token => {
    const t = String(token);
    let resolved;
    if (/^new:\d+$/.test(t)) {
      resolved = newPaths[Number(t.slice(4))];
    } else if (existing.includes(t)) {
      resolved = t;
    }
    if (!resolved || seen.has(resolved)) {
      const err = new Error('Those photos could not be matched up. Please reopen the form and try again.');
      err.code = 'BAD_IMAGES';
      throw err;
    }
    seen.add(resolved);
    return resolved;
  });
}

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

// `input`: { name, price, wt, desc, tags (raw string), badge,
//   imageOrder (tokens, see resolveImageOrder), newImagePaths (already-saved relative paths) }
function addProduct(input) {
  return withCatalog(catalog => {
    const id = uniqueId(catalog, input.name);
    const images = resolveImageOrder([], input.imageOrder, input.newImagePaths || []);
    const product = {
      id,
      name: String(input.name || '').trim(),
      price: Number(input.price),
      wt: String(input.wt || '').trim(),
      ...badgeFields(input.badge),
      img: images[0],
      images,
      tags: parseTags(input.tags),
      desc: String(input.desc || '').trim(),
    };
    catalog.products.push(product);
    return { catalog, returnValue: product };
  });
}

// `updates.imageOrder` is the full, final photo arrangement (see
// resolveImageOrder). Returns { product, removedImagePaths } so the
// caller can delete the files that are no longer referenced.
function updateProduct(id, updates) {
  return withCatalog(catalog => {
    const idx = catalog.products.findIndex(p => p.id === id);
    if (idx === -1) return { catalog: null, returnValue: null };
    const existing = catalog.products[idx];
    const oldImages = imagesOf(existing);
    const images = resolveImageOrder(oldImages, updates.imageOrder, updates.newImagePaths || []);
    const product = {
      ...existing,
      name: String(updates.name || '').trim(),
      price: Number(updates.price),
      wt: String(updates.wt || '').trim(),
      ...badgeFields(updates.badge),
      img: images[0],
      images,
      tags: parseTags(updates.tags),
      desc: String(updates.desc || '').trim(),
    };
    catalog.products[idx] = product;
    const removedImagePaths = oldImages.filter(p => !images.includes(p));
    return { catalog, returnValue: { product, removedImagePaths } };
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
  imagesOf,
  MAX_PRODUCT_IMAGES,
  getConfig,
  VALID_BADGES,
};
