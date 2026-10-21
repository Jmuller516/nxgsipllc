// Prices edited on the admin "Pricing" tab. They're saved in the database and laid over the
// starting prices in config.js, so changing a price never needs a code change.
// Existing bookings keep the price they were quoted (it's stored with the booking).

const config = require('./config');

const PACKAGE_FIELDS = { priceCents: 'int', extraKidCents: 'int', includedKids: 'int', name: 'text', description: 'text', active: 'bool' };
const ADDON_FIELDS = { priceCents: 'int', costCents: 'int', minQty: 'int', leadDays: 'int', name: 'text', detail: 'text', active: 'bool' };
const PARTY_FIELDS = { depositPercent: 'int', balanceDueDaysBefore: 'int', taxRatePercent: 'num' };

// Remember the starting values so "reset" works and overrides can be re-applied cleanly.
const defaults = JSON.parse(JSON.stringify({ packages: config.packages, addOns: config.addOns, payments: config.payments, tax: config.tax }));

function clean(value, type) {
  if (type === 'int') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error('Numbers must be zero or more.');
    return Math.round(n);
  }
  if (type === 'num') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Invalid percentage.');
    return n;
  }
  if (type === 'bool') return !!value;
  const s = String(value ?? '').trim();
  if (!s) throw new Error('Names cannot be blank.');
  return s.slice(0, 300);
}

function load(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'price_overrides'").get();
  return row ? JSON.parse(row.value) : { packages: {}, addOns: {}, party: {} };
}

/** Apply saved overrides on top of the starting prices (mutates the shared config). */
function apply(db, cfg = config) {
  const o = load(db);
  cfg.packages.splice(0, cfg.packages.length, ...defaults.packages.map((p) => ({ active: true, ...p, ...(o.packages[p.id] || {}) })));
  cfg.addOns.splice(0, cfg.addOns.length, ...defaults.addOns.map((a) => ({ active: true, ...a, ...(o.addOns[a.id] || {}) })));
  Object.assign(cfg.payments, defaults.payments, pick(o.party, ['depositPercent', 'balanceDueDaysBefore']));
  cfg.tax.rate = o.party.taxRatePercent != null ? o.party.taxRatePercent / 100 : defaults.tax.rate;
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

function reset(db, cfg = config) {
  db.prepare("DELETE FROM settings WHERE key = 'price_overrides'").run();
  return apply(db, cfg);
}

/** Everything the Pricing tab shows: current values plus the starting values for comparison. */
function view(cfg = config) {
  return {
    packages: cfg.packages.map((p) => ({ ...p, startingPriceCents: defaults.packages.find((d) => d.id === p.id)?.priceCents })),
    addOns: cfg.addOns.map((a) => ({ ...a, startingPriceCents: defaults.addOns.find((d) => d.id === a.id)?.priceCents })),
    addOnCategories: cfg.addOnCategories,
    party: { depositPercent: cfg.payments.depositPercent, balanceDueDaysBefore: cfg.payments.balanceDueDaysBefore, taxRatePercent: +(cfg.tax.rate * 100).toFixed(4) },
  };
}

module.exports = { apply, save, reset, view };
