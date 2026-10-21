const crypto = require('node:crypto');
const config = require('./config');
const pricing = require('./pricing');
const scheduling = require('./scheduling');

class BookingError extends Error {}

/** Today's date in the facility's time zone, YYYY-MM-DD. */
function todayLocal(now = new Date(), tz = config.business.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function makeRef() {
  // e.g. NX-7K3Q9P — no ambiguous characters (0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += alphabet[b % alphabet.length];
  return `NX-${s}`;
}

function createService(db, cfg = config, clock = () => new Date(), hooks = {}) {
  const nowIso = () => clock().toISOString();
  // hooks.onPayment(booking, payment) / hooks.onLead(lead) — emails, QuickBooks. A hook failing never blocks a payment.
  const fire = (name, ...args) => { for (const h of [].concat(hooks[name] || [])) { try { h(...args); } catch (e) { console.error(`${name} hook failed:`, e); } } };

  /** Start times already holding a slot on this date (paid, or unpaid within the hold window). */
  function takenStarts(dateYmd, excludeId = null) {
    const rows = db.prepare(`
      SELECT id, start_min FROM bookings
      WHERE party_date = ?
        AND (status IN ('confirmed','paid') OR (status = 'pending' AND hold_expires_at > ?))
    `).all(dateYmd, nowIso());
    return rows.filter((r) => r.id !== excludeId).map((r) => r.start_min);
  }

  function blocksFor(dateYmd) {
    return db.prepare('SELECT start_min AS startMin, end_min AS endMin, reason FROM blocks WHERE block_date = ?').all(dateYmd);
  }

  function validateDate(dateYmd) {
    const today = todayLocal(clock(), cfg.business.timezone);
    const days = pricing.daysBetween(today, dateYmd);
    if (days < cfg.minDaysAhead) throw new BookingError(`Parties must be booked at least ${cfg.minDaysAhead} days ahead. Call us for last-minute parties.`);
    if (days > cfg.maxDaysAhead) throw new BookingError(`We're only booking ${cfg.maxDaysAhead} days ahead right now.`);
    return today;
  }

  function availability(dateYmd) {
    validateDate(dateYmd);
    return publicSlots(scheduling.slotsForDate(dateYmd, takenStarts(dateYmd), cfg, blocksFor(dateYmd)));
  }

  // Customers only see whether a time is open — never why (no names, no "game room booked").
  function publicSlots(day) {
    const { closedReason, ...rest } = day;
    return { ...rest, slots: day.slots.map(({ reason, ...s }) => s) };
  }

  /**
   * Month view for the public calendar: how many start times are open each day.
   * @param {string} month 'YYYY-MM'
   */
  function calendarMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new BookingError('Invalid month.');
    const [y, m] = month.split('-').map(Number);
    const today = todayLocal(clock(), cfg.business.timezone);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const ahead = pricing.daysBetween(today, date);
      const bookable = ahead >= cfg.minDaysAhead && ahead <= cfg.maxDaysAhead;
      const day = scheduling.slotsForDate(date, takenStarts(date), cfg, blocksFor(date));
      const total = day.slots.length;
      const available = day.slots.filter((s) => s.available).length;
      let status;
      if (ahead < 0) status = 'past';
      else if (!day.open) status = 'closed';
      else if (!bookable) status = ahead < cfg.minDaysAhead ? 'call' : 'later';
      else if (available === 0) status = 'full';
      else if (available <= Math.max(1, Math.floor(total / 4))) status = 'few';
      else status = 'open';
      days.push({ date, status, available: bookable ? available : 0 });
    }
    return { month, today, days, minDaysAhead: cfg.minDaysAhead, maxDaysAhead: cfg.maxDaysAhead };
  }

  /** Staff month view: every party plus closures. */
  function adminMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new BookingError('Invalid month.');
    const from = `${month}-01`, to = `${month}-31`;
    const parties = list({ from, to }).filter((b) => ['pending', 'confirmed', 'paid'].includes(b.status))
      .map((b) => ({ id: b.id, ref: b.ref, date: b.party_date, start: b.start_min, timeLabel: b.timeLabel, endLabel: b.endLabel, status: b.status, child: b.child_name, parent: b.parent_name, kids: b.kids, packageName: b.packageName, balanceCents: b.balanceCents, balanceOverdue: b.balanceOverdue }));
    const blocks = db.prepare(`SELECT id, block_date AS date, start_min AS startMin, end_min AS endMin, reason FROM blocks WHERE block_date BETWEEN ? AND ? ORDER BY block_date, start_min`).all(from, to)
      .map((b) => ({ ...b, allDay: b.startMin <= 0 && b.endMin >= 1440, label: b.startMin <= 0 && b.endMin >= 1440 ? 'All day' : `${scheduling.label12(b.startMin)} – ${scheduling.label12(b.endMin)}` }));
    return { month, parties, blocks };
  }

  function addBlock({ date, start, end, reason }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new BookingError('Choose a date.');
    const startMin = start ? scheduling.toMinutes(start) : 0;
    const endMin = end ? scheduling.toMinutes(end) : 1440;
    if (!(endMin > startMin)) throw new BookingError('End time must be after start time.');
    const info = db.prepare('INSERT INTO blocks (block_date, start_min, end_min, reason) VALUES (?, ?, ?, ?)').run(date, startMin, endMin, clean(reason));
    // Warn staff about parties already booked in the closed time.
    const clashes = list({ from: date, to: date }).filter((b) => ['pending', 'confirmed', 'paid'].includes(b.status)
      && b.start_min < endMin && b.start_min + scheduling.partyMinutes(cfg) > startMin);
    return { id: Number(info.lastInsertRowid), clashes: clashes.map((b) => `${b.timeLabel} ${b.child_name || b.parent_name} (${b.ref})`) };
  }

  function removeBlock(id) {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
  }

  function quoteFor(input) {
    const today = validateDate(input.partyDate);
    return pricing.quote({ ...input, today }, cfg);
  }

  /** Create a pending booking that holds the slot while the customer pays. */
  function create(input) {
    const required = ['parentName', 'email', 'phone'];
    for (const f of required) if (!String(input[f] || '').trim()) throw new BookingError('Please fill in your name, email and phone.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new BookingError('Please enter a valid email.');

    const q = quoteFor(input);
    const start = scheduling.toMinutes(String(input.time || ''));
    if (!Number.isFinite(start)) throw new BookingError('Please choose a start time.');

    db.exec('BEGIN IMMEDIATE');
    try {
      const slots = scheduling.slotsForDate(input.partyDate, takenStarts(input.partyDate), cfg, blocksFor(input.partyDate));
      if (!slots.open) throw new BookingError(slots.closedReason ? "Sorry — we're closed that day. Please pick another date." : "We don't run parties on that day.");
      const slot = slots.slots.find((s) => s.start === start);
      if (!slot) throw new BookingError('That start time is not offered.');
      if (!slot.available) throw new BookingError('Sorry — that time was just taken. Please pick another.');

      const ref = makeRef();
      const token = crypto.randomBytes(16).toString('hex');
      const holdExpires = new Date(clock().getTime() + cfg.payments.holdMinutes * 60000).toISOString();
      const info = db.prepare(`
        INSERT INTO bookings (ref, token, status, party_date, start_min, package_id, kids, child_name, child_age,
          parent_name, email, phone, notes, quote_json, total_cents, deposit_cents, balance_due_date, hold_expires_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ref, token, input.partyDate, start, q.packageId, q.kids,
        clean(input.childName), input.childAge ? Number(input.childAge) : null,
        clean(input.parentName), clean(input.email).toLowerCase(), clean(input.phone), clean(input.notes),
        JSON.stringify(q), q.totalCents, q.depositCents, q.balanceDueDate, holdExpires);
      db.exec('COMMIT');
      return get(Number(info.lastInsertRowid));
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function get(id) {
    return decorate(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
  }
  function getByRef(ref) {
    return decorate(db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref));
  }

  /**
   * Record money received. Idempotent per Stripe session.
   * kind: deposit | balance | full ; method: stripe | card_in_person | cash | check | demo
   */
  function recordPayment(bookingId, { kind, method, amountCents, stripeSessionId = null, paymentIntent = null, note = null }) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (stripeSessionId && db.prepare('SELECT 1 FROM payments WHERE stripe_session_id = ?').get(stripeSessionId)) {
        db.exec('COMMIT');
        return get(bookingId);
      }
      const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (!b) throw new BookingError('Booking not found.');
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new BookingError('Invalid amount.');
      const pinfo = db.prepare(`INSERT INTO payments (booking_id, kind, method, amount_cents, stripe_session_id, stripe_payment_intent, note)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(bookingId, kind, method, amountCents, stripeSessionId, paymentIntent, note);
      const paid = b.paid_cents + amountCents;
      // A late payment on an expired hold still confirms the booking; staff will see it in the dashboard.
      const status = b.status === 'cancelled' ? 'cancelled' : paid >= b.total_cents ? 'paid' : 'confirmed';
      db.prepare(`UPDATE bookings SET paid_cents = ?, status = ?, hold_expires_at = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(paid, status, bookingId);
      db.exec('COMMIT');
      const booking = get(bookingId);
      fire('onPayment', booking, db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(pinfo.lastInsertRowid)));
      return booking;
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  }

  function cancel(bookingId, reason) {
    db.prepare(`UPDATE bookings SET status = 'cancelled', notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`)
      .run(`Cancelled: ${reason || 'no reason given'}`, bookingId);
    return get(bookingId);
  }

  /** Mark unpaid holds past their time as expired so they free the slot. */
  function expireHolds() {
    return db.prepare(`UPDATE bookings SET status = 'expired', updated_at = datetime('now') WHERE status = 'pending' AND hold_expires_at <= ?`).run(nowIso()).changes;
  }

  function list({ from, to, status } = {}) {
    let sql = 'SELECT * FROM bookings WHERE 1=1';
    const args = [];
    if (from) { sql += ' AND party_date >= ?'; args.push(from); }
    if (to) { sql += ' AND party_date <= ?'; args.push(to); }
    if (status) { sql += ' AND status = ?'; args.push(status); }
    sql += ' ORDER BY party_date, start_min';
    return db.prepare(sql).all(...args).map(decorate);
  }

  function payments(bookingId) {
    return db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY id').all(bookingId);
  }

  function decorate(b) {
    if (!b) return null;
    const quote = JSON.parse(b.quote_json);
    const pkg = cfg.packages.find((p) => p.id === b.package_id);
    const today = todayLocal(clock(), cfg.business.timezone);
    const balanceCents = Math.max(0, b.total_cents - b.paid_cents);
    return {
      ...b,
      quote,
      packageName: pkg ? pkg.name : b.package_id,
      timeLabel: scheduling.label12(b.start_min),
      endLabel: scheduling.label12(b.start_min + scheduling.partyMinutes(cfg)),
      schedule: scheduling.windowsFor(b.start_min, cfg).phases.map((p) => ({ label: p.label, from: scheduling.label12(p.start), to: scheduling.label12(p.end) })),
      balanceCents,
      balanceOverdue: balanceCents > 0 && b.status === 'confirmed' && b.balance_due_date && b.balance_due_date < today,
    };
  }

  /** Numbers for the admin dashboard. */
  function summary() {
    const today = todayLocal(clock(), cfg.business.timezone);
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const collected = one(`SELECT COALESCE(SUM(amount_cents),0) c FROM payments`).c;
    const upcoming = one(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) t, COALESCE(SUM(total_cents - paid_cents),0) owed
                          FROM bookings WHERE status IN ('confirmed','paid') AND party_date >= ?`, today);
    const overdue = one(`SELECT COUNT(*) n, COALESCE(SUM(total_cents - paid_cents),0) owed FROM bookings
                         WHERE status = 'confirmed' AND balance_due_date < ? AND total_cents > paid_cents`, today);
    const byMonth = db.prepare(`
      SELECT substr(party_date,1,7) month, COUNT(*) parties, SUM(total_cents) booked_cents, SUM(paid_cents) paid_cents
      FROM bookings WHERE status IN ('confirmed','paid') GROUP BY month ORDER BY month`).all();
    const newLeads = one(`SELECT COUNT(*) n FROM leads WHERE status = 'new'`).n;

    // Vendor order totals for upcoming parties (what to order from each vendor).
    const vendors = {};
    for (const b of list({ from: today }).filter((b) => ['confirmed', 'paid'].includes(b.status))) {
      for (const l of b.quote.lines.filter((l) => l.vendor)) {
        const v = (vendors[l.vendor] ||= { vendor: l.vendor, items: {}, costCents: 0 });
        v.items[l.name] = (v.items[l.name] || 0) + l.qty;
        v.costCents += (l.costCents || 0) * l.qty;
      }
    }
    return { today, collectedCents: collected, upcoming, overdue, byMonth, newLeads, vendors: Object.values(vendors) };
  }

  // ---- Leads (corporate, adult, senior, team events) ----
  function createLead(input) {
    if (!clean(input.name) || !clean(input.email)) throw new BookingError('Please include your name and email.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new BookingError('Please enter a valid email.');
    if (!cfg.inquiryTypes.some((t) => t.id === input.eventType)) throw new BookingError('Please choose an event type.');
    const info = db.prepare(`INSERT INTO leads (event_type, name, organization, email, phone, preferred_date, group_size, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(input.eventType, clean(input.name), clean(input.organization),
      clean(input.email).toLowerCase(), clean(input.phone), clean(input.preferredDate),
      input.groupSize ? Number(input.groupSize) : null, clean(input.message));
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(info.lastInsertRowid));
    fire('onLead', lead);
    return lead;
  }

  function listLeads() {
    return db.prepare(`SELECT * FROM leads ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, created_at DESC`).all();
  }

  function updateLead(id, { status, followUpDate, staffNotes }) {
    const allowed = ['new', 'contacted', 'quoted', 'booked', 'lost'];
    if (status && !allowed.includes(status)) throw new BookingError('Invalid lead status.');
    db.prepare(`UPDATE leads SET status = COALESCE(?, status), follow_up_date = COALESCE(?, follow_up_date),
      staff_notes = COALESCE(?, staff_notes), updated_at = datetime('now') WHERE id = ?`)
      .run(status || null, followUpDate ?? null, staffNotes ?? null, id);
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  }

  return { calendarMonth, adminMonth, addBlock, removeBlock, availability, quoteFor, create, get, getByRef, recordPayment, cancel, expireHolds, list, payments, summary, createLead, listLeads, updateLead, takenStarts };
}

function clean(v) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 2000) : null;
}

module.exports = { createService, BookingError, todayLocal };
