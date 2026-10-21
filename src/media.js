// Images stored in the database (product photos, the birthday child's photo, waiver signatures).
const crypto = require('node:crypto');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

class MediaError extends Error {}

/** Save a data: URL image. Returns its public path, e.g. /media/ab12….jpg */
function saveDataUrl(db, dataUrl, { maxBytes = 2_000_000, label = 'photo' } = {}) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new MediaError(`Please choose a JPEG, PNG or WebP ${label}.`);
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw new MediaError(`That ${label} is empty.`);
  if (bytes.length > maxBytes) throw new MediaError(`That ${label} is too large. Please use one under ${Math.round(maxBytes / 1_000_000)} MB.`);
  const id = crypto.randomBytes(10).toString('hex');
  db.prepare('INSERT INTO media (id, content_type, bytes) VALUES (?, ?, ?)').run(id, m[1], bytes);
  return `/media/${id}.${TYPES[m[1]]}`;
}

function remove(db, path) {
  const m = /^\/media\/([a-f0-9]+)\./.exec(path || '');
  if (m) db.prepare('DELETE FROM media WHERE id = ?').run(m[1]);
}

/** Read a stored image as a data: URL (used for the admin waiver view). */
function asDataUrl(db, path) {
  const m = /^\/media\/([a-f0-9]+)\./.exec(path || '');
  if (!m) return null;
  const row = db.prepare('SELECT content_type, bytes FROM media WHERE id = ?').get(m[1]);
  return row ? `data:${row.content_type};base64,${Buffer.from(row.bytes).toString('base64')}` : null;
}

module.exports = { saveDataUrl, remove, asDataUrl, MediaError };
