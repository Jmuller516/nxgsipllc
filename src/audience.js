// Families who said yes to hearing about camps, clinics and party offers (a checkbox on the RSVP,
// waiver and booking forms; never pre-checked). Every marketing email has a one-click unsubscribe link.

const { signer } = require('./secrets');
const config = require('./config');
const { addDays } = require('./pricing');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function createAudience(db, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());

  // Unsubscribe links are signed so nobody can unsubscribe someone else's email.
  const sig = signer(db, 'unsubscribe', 24);
  const unsubscribeKey = (email) => sig.sign(String(email).toLowerCase());
  const validKey = (email, key) => sig.check(String(email).toLowerCase(), key);

  /** Record a yes. A family that unsubscribed and ticks the box again is subscribed again. */
  function optIn({ email, name, childName, phone, source, bookingId, lang }) {
    const e = clean(email)?.toLowerCase();
    if (!e || !EMAIL.test(e)) return false;
    const now = clock().toISOString();
    db.prepare(`INSERT INTO contacts (email, name, child_name, phone, source, booking_id, lang, opted_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, contacts.name), child_name = COALESCE(excluded.child_name, contacts.child_name),
        phone = COALESCE(excluded.phone, contacts.phone), lang = excluded.lang, unsubscribed_at = NULL,
        booking_id = CASE WHEN contacts.source = 'booking' THEN contacts.booking_id ELSE COALESCE(excluded.booking_id, contacts.booking_id) END`)
      .run(e, clean(name, 120), clean(childName, 120), clean(phone, 40), source, bookingId || null, (cfg.languages || ['en']).includes(lang) ? lang : 'en', now);
    return true;
  }

  function unsubscribe(email) {
    const info = db.prepare(`UPDATE contacts SET unsubscribed_at = ? WHERE email = ? AND unsubscribed_at IS NULL`).run(clock().toISOString(), String(email).toLowerCase());
    return info.changes > 0;
  }

  function isSubscribed(email) {
    return !!db.prepare('SELECT 1 FROM contacts WHERE email = ? AND unsubscribed_at IS NULL').get(String(email || '').toLowerCase());
  }

  /** Guest families to send the "your turn to celebrate" offer to today. */
  function dueOffers(today) {
    const g = cfg.guestOffer || {};
    if (!g.enabled) return [];
    const partyDay = addDays(today, -(g.daysAfterParty ?? 2));
    const recent = addDays(today, -60);
    return db.prepare(`SELECT c.*, b.id AS b_id FROM contacts c JOIN bookings b ON b.id = c.booking_id
      WHERE c.source IN ('rsvp','waiver') AND c.unsubscribed_at IS NULL AND b.party_date = ? AND b.status IN ('confirmed','paid')
        AND (c.last_offer_at IS NULL OR substr(c.last_offer_at,1,10) < ?) AND lower(b.email) <> c.email`).all(partyDay, recent);
  }

  function markOffered(email) {
    db.prepare('UPDATE contacts SET last_offer_at = ? WHERE email = ?').run(clock().toISOString(), email);
  }

  function list() {
    return db.prepare(`SELECT c.*, b.ref, b.party_date, b.child_name AS party_child FROM contacts c LEFT JOIN bookings b ON b.id = c.booking_id ORDER BY c.opted_in_at DESC`).all();
  }

  function stats() {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      subscribed: one('SELECT COUNT(*) n FROM contacts WHERE unsubscribed_at IS NULL'),
      fromGuests: one("SELECT COUNT(*) n FROM contacts WHERE unsubscribed_at IS NULL AND source IN ('rsvp','waiver')"),
      fromBookings: one("SELECT COUNT(*) n FROM contacts WHERE unsubscribed_at IS NULL AND source = 'booking'"),
      unsubscribed: one('SELECT COUNT(*) n FROM contacts WHERE unsubscribed_at IS NOT NULL'),
      offersSent: one('SELECT COUNT(*) n FROM contacts WHERE last_offer_at IS NOT NULL'),
    };
  }

  return { optIn, unsubscribe, isSubscribed, unsubscribeKey, validKey, dueOffers, markOffered, list, stats };
}

module.exports = { createAudience };
