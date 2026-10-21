// Sponsors: who they are, what they paid for, where their logo shows, and how it's performing.
const config = require('./config');
const { BookingError, todayLocal } = require('./bookings');

const PLACEMENTS = ['booking', 'calendar', 'invite', 'email', 'runsheet'];
const clean = (v, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createSponsors(db, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const today = () => todayLocal(clock(), cfg.business.timezone);

  const row = (r) => r && ({ ...r, placements: JSON.parse(r.placements || '[]') });

  function validate(input, existing = {}) {
    const name = clean(input.name ?? existing.name, 120);
    if (!name) throw new BookingError('Enter the sponsor name.');
    let website = clean(input.website ?? existing.website, 300);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website) { try { new URL(website); } catch { throw new BookingError('Check the website address.'); } }
    const placements = (input.placements ?? existing.placements ?? []).filter((p) => PLACEMENTS.includes(p));
    const pkg = input.packageId ?? existing.package_id ?? null;
    if (pkg && !cfg.sponsorPackages.some((p) => p.id === pkg)) throw new BookingError('Unknown sponsorship package.');
    const loc = input.locationId === undefined ? existing.location_id : (input.locationId || null);
    if (loc && !cfg.locations.some((l) => l.id === loc)) throw new BookingError('Unknown location.');
    for (const d of ['startsOn', 'endsOn']) if (input[d] && !/^\d{4}-\d{2}-\d{2}$/.test(input[d])) throw new BookingError('Dates must be YYYY-MM-DD.');
    const status = input.status ?? existing.status ?? 'active';
    if (!['active', 'paused', 'ended'].includes(status)) throw new BookingError('Invalid status.');
    const email = clean(input.contactEmail ?? existing.contact_email, 200);
    if (email && !EMAIL.test(email)) throw new BookingError('Check the contact email.');
    const contract = input.contractDollars !== undefined ? Math.round(Number(input.contractDollars) * 100) : (existing.contract_cents ?? 0);
    if (!Number.isFinite(contract) || contract < 0) throw new BookingError('Contract value must be a number.');
    return {
      name, website, tagline: clean(input.tagline ?? existing.tagline, 140), package_id: pkg, placements: JSON.stringify(placements), location_id: loc || null,
      starts_on: input.startsOn !== undefined ? (input.startsOn || null) : existing.starts_on ?? null,
      ends_on: input.endsOn !== undefined ? (input.endsOn || null) : existing.ends_on ?? null,
      contract_cents: contract, billing: clean(input.billing ?? existing.billing, 40), status,
      contact_name: clean(input.contactName ?? existing.contact_name, 120), contact_email: email, contact_phone: clean(input.contactPhone ?? existing.contact_phone, 40),
      notes: clean(input.notes ?? existing.notes, 2000),
    };
  }

  function create(input) {
    const v = validate(input);
    const cols = Object.keys(v);
    const info = db.prepare(`INSERT INTO sponsors (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(v));
    return get(Number(info.lastInsertRowid));
  }

  function update(id, input) {
    const existing = db.prepare('SELECT * FROM sponsors WHERE id = ?').get(id);
    if (!existing) throw new BookingError('Sponsor not found.');
    const v = validate(input, { ...existing, placements: JSON.parse(existing.placements) });
    db.prepare(`UPDATE sponsors SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(v), id);
    return get(id);
  }

  function setLogo(id, path) {
    const old = db.prepare('SELECT logo FROM sponsors WHERE id = ?').get(id);
    if (!old) throw new BookingError('Sponsor not found.');
    db.prepare('UPDATE sponsors SET logo = ? WHERE id = ?').run(path, id);
    return old.logo;
  }

  function get(id) { return row(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(id)); }

  function list() {
    const t = today();
    return db.prepare('SELECT * FROM sponsors ORDER BY status = \'active\' DESC, created_at DESC').all().map(row).map((s) => ({
      ...s, live: isLive(s, t), ctr: s.impressions ? Math.round((s.clicks / s.impressions) * 1000) / 10 : 0,
    }));
  }

  function isLive(s, t = today()) {
    return s.status === 'active' && (!s.starts_on || s.starts_on <= t) && (!s.ends_on || s.ends_on >= t);
  }

  /** Sponsors to show in one spot. Counts an impression for each when `count` is set. */
  function forPlacement(placement, locationId = null, { count = false } = {}) {
    const t = today();
    const live = list().filter((s) => isLive(s, t) && s.placements.includes(placement) && (!s.location_id || s.location_id === locationId));
    if (count && live.length) {
      const stmt = db.prepare('UPDATE sponsors SET impressions = impressions + 1 WHERE id = ?');
      for (const s of live) stmt.run(s.id);
    }
    return live.map((s) => ({ id: s.id, name: s.name, logo: s.logo, tagline: s.tagline, hasLink: !!s.website }));
  }

  /** A click on a sponsor's logo: count it and return where to send the visitor. */
  function click(id) {
    const s = get(id);
    if (!s || !s.website) return null;
    db.prepare('UPDATE sponsors SET clicks = clicks + 1 WHERE id = ?').run(id);
    return s.website;
  }

  function totals() {
    const all = list();
    return {
      activeCount: all.filter((s) => s.live).length,
      activeContractCents: all.filter((s) => s.live).reduce((sum, s) => sum + s.contract_cents, 0),
      impressions: all.reduce((sum, s) => sum + s.impressions, 0),
      clicks: all.reduce((sum, s) => sum + s.clicks, 0),
    };
  }

  return { create, update, setLogo, get, list, forPlacement, click, totals, PLACEMENTS };
}

module.exports = { createSponsors, PLACEMENTS };
