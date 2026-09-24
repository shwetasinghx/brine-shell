/* =========================================
   AES-256-GCM encryption for personal data at rest -- return-request
   photos/videos on disk, and free-text personal fields (reason, the
   said-phrase challenge, customer email) in the Returns sheet. Built
   to satisfy the DPDP Act, 2023 / DPDP Rules, 2025 expectation that
   personal data be protected by "reasonable security safeguards"
   (DPDP Rules, Rule 6) -- not just access-controlled. If the disk or
   the Sheet is ever copied, exported, or reached outside this app,
   the content stays unreadable without DATA_ENCRYPTION_KEY.

   Format, for both buffers and text: [12-byte IV][16-byte auth tag][ciphertext],
   base64-encoded when stored as text (a Sheet cell). GCM is
   authenticated encryption specifically so decrypting also verifies
   the ciphertext wasn't corrupted or tampered with, not just that it
   *looks* like valid bytes.

   Key management: for this single-server, single-admin setup, the
   key lives in .env (DATA_ENCRYPTION_KEY -- 32 random bytes, base64),
   the same trust model already used for SESSION_SECRET and the SMTP/
   Sheets credentials in that same file. That's the pragmatic
   "envelope key in a secrets file" approach appropriate at this
   scale. A growing team should graduate this to a real KMS/HSM (AWS
   KMS, GCP KMS, HashiCorp Vault) so the key is never stored on the
   same machine as the ciphertext it protects -- doing that later just
   means swapping what getKey() below reads from, not touching any
   already-encrypted data or its format.
   ========================================= */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is the size GCM is designed for
const TAG_LENGTH = 16;

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('DATA_ENCRYPTION_KEY is not set in .env -- generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (a base64-encoded AES-256 key) -- regenerate it with the command above.');
  }
  cachedKey = key;
  return key;
}

/* Encrypts a Buffer (a photo/video's raw bytes) into a single Buffer
   carrying its own IV and auth tag, ready to write straight to disk. */
function encryptBuffer(plainBuffer) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/* Reverses encryptBuffer(). Throws (auth tag mismatch) if the file
   was corrupted, truncated, or tampered with since encryption. */
function decryptBuffer(encBuffer) {
  const iv = encBuffer.subarray(0, IV_LENGTH);
  const tag = encBuffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encBuffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/* Same scheme for a short piece of text (a Sheet cell) -- returned as
   one base64 string so it drops into a plain string column with no
   schema change. A blank/empty value passes through as '' rather than
   turning into ciphertext noise for an optional field left empty. */
function encryptText(plainText) {
  const str = String(plainText || '');
  if (!str) return '';
  return encryptBuffer(Buffer.from(str, 'utf8')).toString('base64');
}

/* Reverses encryptText(). Rows written before a column was encrypted
   hold plain text, not ciphertext -- decrypting those will fail (the
   auth tag won't verify), so this fails SOFT: log it and return the
   raw stored value rather than breaking the whole admin table over
   one old row. New rows always decrypt cleanly. */
function decryptText(storedText) {
  const str = String(storedText || '');
  if (!str) return '';
  try {
    return decryptBuffer(Buffer.from(str, 'base64')).toString('utf8');
  } catch (err) {
    console.error('decryptText failed, returning raw stored value (likely a pre-encryption row):', err.message);
    return str;
  }
}

module.exports = { encryptBuffer, decryptBuffer, encryptText, decryptText };
