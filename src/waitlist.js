// Waitlist: families who wanted a day that was full. When a time opens up on that day
// (a cancellation, an unpaid hold expiring, a party moving, staff reopening a closed time),
// everyone waiting for that day gets an email (and a text if they opted in). First to book wins.

const config = require('./config');
const { BookingError } = require('./bookings');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function createWaitlist(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const hooks = opts.hooks || {};
  const fire = (name, ...args) => { for (const h of [].concat(hooks[name] || [])) { try { h(...args); } catch (e) { console.error(`${name} hook failed:`, e); } } };

  function join(input) {
    const date = String(input.date || '');
    svc.validateDate(date);
    const loc = svc.location(input.locationId);
    const name = clean(input.parentName, 120);
    const email = clean(input.email)?.toLowerCase();
    if (!name) throw new BookingError('Please enter your name.');
    if (!email || !EMAIL.test(email)) throw new BookingError('Please enter a valid email.');
    const pkg = cfg.packages.some((p) => p.id === input.packageId) ? input.packageId : null;
    const existing = db.prepare(`SELECT id FROM waitlist WHERE email = ? AND party_date = ? AND location_id = ? AND status IN ('waiting','notified')`).get(email, date, loc.id);
    if (existing) {
      db.prepare(`UPDATE waitlist SET status = 'waiting', package_id = COALESCE(?, package_id), kids = COALESCE(?, kids), phone = COALESCE(?, phone) WHERE id = ?`)
        .run(pkg, input.kids ? Number(input.kids) : null, clean(input.phone, 40), existing.id);
      return { ok: true, id: existing.id, already: true };
    }
    const info = db.prepare(`INSERT INTO waitlist (location_id, party_date, package_id, kids, parent_name, email, phone, sms_opt_in, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(loc.id, date, pkg, input.kids ? Math.max(1, Math.min(200, Number(input.kids) || 0)) || null : null, name, email, clean(input.phone, 40), input.smsOptIn ? 1 : 0,
        (cfg.languages || ['en']).includes(input.lang) ? input.lang : 'en');
    return { ok: true, id: Number(info.lastInsertRowid) };
  }

  /** A time may have opened on this date: tell everyone waiting, if anything is actually open now. */
  function slotOpened(date, locationId) {
    if (!date) return 0;
    const loc = locationId || cfg.defaultLocation;
    const waiting = db.prepare(`SELECT * FROM waitlist WHERE party_date = ? AND location_id = ? AND status = 'waiting'`).all(date, loc);
    if (!waiting.length) return 0;
    let open = [];
    try {
      // Check per package so a 90-minute party isn't promised a 2-hour gap (and vice versa).
      open = waiting.filter((w) => svc.availability(date, loc, w.package_id).slots.some((s) => s.available));
    } catch { return 0; } // date is now too close or past
    const now = clock().toISOString();
    for (const w of open) {
      db.prepare(`UPDATE waitlist SET status = 'notified', notified_at = ? WHERE id = ?`).run(now, w.id);
      fire('onWaitlistOpen', w);
    }
    return open.length;
  }

  /** A waitlisted family booked that day: mark them done. */
  function onBooked(booking) {
    db.prepare(`UPDATE waitlist SET status = 'booked' WHERE email = ? AND party_date = ? AND location_id = ? AND status IN ('waiting','notified')`)
      .run(booking.email, booking.party_date, booking.location_id);
  }

  function list({ from } = {}) {
    return db.prepare(`SELECT * FROM waitlist WHERE party_date >= ? ORDER BY party_date, created_at`).all(from || svc.todayLocal());
  }

  function remove(id) {
    db.prepare(`UPDATE waitlist SET status = 'removed' WHERE id = ?`).run(id);
  }

  function stats() {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      joined: one(`SELECT COUNT(*) n FROM waitlist`),
      waiting: one(`SELECT COUNT(*) n FROM waitlist WHERE status = 'waiting'`),
      notified: one(`SELECT COUNT(*) n FROM waitlist WHERE notified_at IS NOT NULL`),
      booked: one(`SELECT COUNT(*) n FROM waitlist WHERE status = 'booked'`),
    };
  }

  return { join, slotOpened, onBooked, list, remove, stats };
}

module.exports = { createWaitlist };
