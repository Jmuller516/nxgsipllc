// Prices edited on the admin "Pricing" tab. They're saved in the database and laid over the
// starting prices in config.js, so changing a price never needs a code change.
// Existing bookings keep the price they were quoted (it's stored with the booking).

const config = require('./config');

const PACKAGE_FIELDS = { priceCents: 'int', extraKidCents: 'int', includedKids: 'int', name: 'text', description: 'text', includes: 'longtext', active: 'bool' };
const ADDON_FIELDS = { priceCents: 'int', costCents: 'int', minQty: 'int', leadDays: 'int', name: 'text', detail: 'text', includes: 'longtext', active: 'bool' };
const PARTY_FIELDS = { depositPercent: 'int', balanceDueDaysBefore: 'int', taxRatePercent: 'num' };
const TIME_FIELDS = { adjustCents: 'signed', active: 'bool', label: 'text' };

// Remember the starting values so "reset" works and overrides can be re-applied cleanly.
const defaults = JSON.parse(JSON.stringify({ packages: config.packages, addOns: config.addOns, payments: config.payments, tax: config.tax, timePricing: config.timePricing || [] }));

function clean(value, type) {
  if (type === 'int') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error('Numbers must be zero or more.');
    return Math.round(n);
  }
  if (type === 'signed') {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) throw new Error('Invalid amount.');
    return Math.round(n);
  }
  if (type === 'num') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Invalid percentage.');
    return n;
  }
  if (type === 'bool') return !!value;
  if (type === 'longtext') return String(value ?? '').replace(/\r/g, '').trim().slice(0, 1500);
  const s = String(value ?? '').trim();
  if (!s) throw new Error('Names cannot be blank.');
  return s.slice(0, 300);
}

function load(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'price_overrides'").get();
  const o = row ? JSON.parse(row.value) : {};
  return { packages: {}, addOns: {}, party: {}, timePricing: {}, ...o };
}

/** Apply saved overrides on top of the starting prices (mutates the shared config). */
function apply(db, cfg = config) {
  const o = load(db);
  cfg.packages.splice(0, cfg.packages.length, ...defaults.packages.map((p) => ({ active: true, ...p, ...(o.packages[p.id] || {}) })));
  cfg.addOns.splice(0, cfg.addOns.length, ...defaults.addOns.map((a) => ({ active: true, photo: '', ...a, ...(o.addOns[a.id] || {}) })));
  Object.assign(cfg.payments, defaults.payments, pick(o.party, ['depositPercent', 'balanceDueDaysBefore']));
  cfg.tax.rate = o.party.taxRatePercent != null ? o.party.taxRatePercent / 100 : defaults.tax.rate;
  cfg.timePricing = defaults.timePricing.map((r) => ({ active: true, ...r, ...(o.timePricing[r.id] || {}) }));
  return cfg;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj?.[k] != null).map((k) => [k, obj[k]]));
}

/** Save a batch of edits: { packages: {id: {...}}, addOns: {id: {...}}, party: {...} } */
function save(db, edits, cfg = config) {
  const o = load(db);
  for (const [group, fields, list] of [['packages', PACKAGE_FIELDS, defaults.packages], ['addOns', ADDON_FIELDS, defaults.addOns]]) {
    for (const [id, changes] of Object.entries(edits[group] || {})) {
      if (!list.some((x) => x.id === id)) throw new Error(`Unknown item: ${id}`);
      const target = (o[group][id] ||= {});
      for (const [k, v] of Object.entries(changes)) {
        if (!fields[k]) continue;
        target[k] = clean(v, fields[k]);
      }
    }
  }
  for (const [id, changes] of Object.entries(edits.timePricing || {})) {
    if (!defaults.timePricing.some((r) => r.id === id)) throw new Error(`Unknown item: ${id}`);
    const target = (o.timePricing[id] ||= {});
    for (const [k, v] of Object.entries(changes)) if (TIME_FIELDS[k]) target[k] = clean(v, TIME_FIELDS[k]);
  }
  for (const [k, v] of Object.entries(edits.party || {})) {
    if (!PARTY_FIELDS[k]) continue;
    o.party[k] = clean(v, PARTY_FIELDS[k]);
  }
  if (o.party.depositPercent != null && (o.party.depositPercent < 1 || o.party.depositPercent > 100)) throw new Error('Deposit must be between 1% and 100%.');
  if (!defaults.packages.some((p) => (o.packages[p.id]?.active ?? true))) throw new Error('At least one package must stay on.');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('price_overrides', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(o));
  return apply(db, cfg);
}

/** Set (or with null, remove) an add-on's uploaded product photo. Returns the old photo path. */
function setPhoto(db, id, photoPath, cfg = config) {
  if (!defaults.addOns.some((a) => a.id === id)) throw new Error(`Unknown item: ${id}`);
  const o = load(db);
  const old = o.addOns[id]?.photo || null;
  const target = (o.addOns[id] ||= {});
  if (photoPath) target.photo = photoPath; else delete target.photo;
  db.prepare(`INSERT INTO settings (key, value) VALUES ('price_overrides', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(o));
  apply(db, cfg);
  return old;
}

function reset(db, cfg = config) {
  // Keep uploaded photos when resetting prices.
  const photos = Object.fromEntries(Object.entries(load(db).addOns).filter(([, v]) => v.photo).map(([k, v]) => [k, { photo: v.photo }]));
  db.prepare("DELETE FROM settings WHERE key = 'price_overrides'").run();
  if (Object.keys(photos).length) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('price_overrides', ?)").run(JSON.stringify({ packages: {}, addOns: photos, party: {}, timePricing: {} }));
  }
  return apply(db, cfg);
}

/** Everything the Pricing tab shows: current values plus the starting values for comparison. */
function view(cfg = config) {
  return {
    packages: cfg.packages.map((p) => ({ ...p, startingPriceCents: defaults.packages.find((d) => d.id === p.id)?.priceCents })),
    addOns: cfg.addOns.filter((a) => !a.marketplace).map((a) => ({ ...a, startingPriceCents: defaults.addOns.find((d) => d.id === a.id)?.priceCents })),
    addOnCategories: cfg.addOnCategories,
    timePricing: cfg.timePricing.map((r) => ({ ...r, startingCents: defaults.timePricing.find((d) => d.id === r.id)?.adjustCents })),
    party: { depositPercent: cfg.payments.depositPercent, balanceDueDaysBefore: cfg.payments.balanceDueDaysBefore, taxRatePercent: +(cfg.tax.rate * 100).toFixed(4) },
  };
}

module.exports = { apply, save, reset, view, setPhoto };
