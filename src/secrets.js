// Random secrets kept in the settings table (generated on first use), for signing links.
const crypto = require('node:crypto');

function secret(db, name) {
  const key = `secret_${name}`;
  let row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(crypto.randomBytes(24).toString('hex')));
    row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  }
  return JSON.parse(row.value);
}

/** Short signature for `value`, and a constant-time check of one. */
function signer(db, name, length = 16) {
  const sign = (value) => crypto.createHmac('sha256', secret(db, name)).update(String(value)).digest('hex').slice(0, length);
  const check = (value, sig) => {
    const a = Buffer.from(sign(value)), b = Buffer.from(String(sig || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  return { sign, check };
}

module.exports = { secret, signer };
