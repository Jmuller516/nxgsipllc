// Door check-in. Staff tap guests in on a tablet, or scan the check-in pass a guest got after
// RSVPing (a QR code). Scanning with any phone camera opens /c/<code>, which needs the admin login.

const { signer } = require('./secrets');
const { BookingError } = require('./bookings');

const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function createCheckin(db, svc, guests, opts = {}) {
  const clock = opts.clock || (() => new Date());
  const sig = signer(db, 'checkin', 12);

  /** Everyone expected at one party, with waiver and arrival status. */
  function roster(bookingId) {
    const b = svc.get(bookingId);
    if (!b) throw new BookingError('Party not found.');
    const g = guests.partyGuests(b.id);
    const arrived = Object.fromEntries(db.prepare('SELECT child_key, child_name, checked_in_at, how FROM checkins WHERE booking_id = ?').all(b.id).map((r) => [r.child_key, r]));
    const people = [];
    if (b.child_name) people.push({ name: b.child_name, birthdayChild: true, parentName: b.parent_name, waiver: g.birthdayChild?.waiver || false, allergies: b.details?.allergies || null });
    for (const x of g.guests.filter((x) => x.attending === 'yes')) people.push({ name: x.childName, parentName: x.parentName, waiver: x.waiver, allergies: x.allergies && !/^(none|no|n\/a|na)\.?$/i.test(x.allergies) ? x.allergies : null, walkIn: !!x.walkIn });
    // Kids checked in at the door who never RSVP'd.
    for (const [k, r] of Object.entries(arrived)) {
      if (!people.some((p) => key(p.name) === k)) people.push({ name: r.child_name, walkIn: true, waiver: !!g.guests.find((x) => key(x.childName) === k)?.waiver });
    }
    for (const p of people) { const a = arrived[key(p.name)]; p.key = key(p.name); p.arrivedAt = a?.checked_in_at || null; p.how = a?.how || null; }
    return {
      booking: { id: b.id, ref: b.ref, child: b.child_name, parent: b.parent_name, phone: b.phone, date: b.party_date, timeLabel: b.timeLabel, endLabel: b.endLabel, kids: b.kids, packageName: b.packageName, host: b.host_name, inviteToken: b.invite_token },
      people,
      arrived: people.filter((p) => p.arrivedAt).length,
      expected: people.length,
      booked: b.kids,
    };
  }

  function checkIn(bookingId, childName, how = 'tap') {
    const b = svc.get(bookingId);
    if (!b || !['confirmed', 'paid'].includes(b.status)) throw new BookingError('That party is not active.');
    const name = String(childName || '').trim().slice(0, 120);
    if (!name) throw new BookingError("Enter the child's name.");
    db.prepare(`INSERT OR IGNORE INTO checkins (booking_id, child_key, child_name, how, checked_in_at) VALUES (?, ?, ?, ?, ?)`)
      .run(b.id, key(name), name, how, clock().toISOString());
    return roster(b.id);
  }

  function undo(bookingId, childKey) {
    db.prepare('DELETE FROM checkins WHERE booking_id = ? AND child_key = ?').run(bookingId, key(childKey));
    return roster(bookingId);
  }

  // ---- check-in passes (QR codes) ----
  /** Code for a guest's RSVP ("r12") or the birthday child ("b7"), signed so it can't be made up. */
  const passCode = (kind, id) => `${kind}${id}.${sig.sign(`${kind}${id}`)}`;
  function passForRsvp(rsvpToken) {
    const r = db.prepare('SELECT id FROM rsvps WHERE token = ?').get(String(rsvpToken || ''));
    return r ? passCode('r', r.id) : null;
  }
  function passForBooking(bookingId) { return passCode('b', bookingId); }

  /** Scan: work out who the pass is for and check them in. */
  function scan(code) {
    const m = /^([rb])(\d+)\.([a-f0-9]+)$/.exec(String(code || ''));
    if (!m || !sig.check(`${m[1]}${m[2]}`, m[3])) throw new BookingError('This check-in pass is not valid.');
    let bookingId, name;
    if (m[1] === 'r') {
      const r = db.prepare('SELECT booking_id, child_name FROM rsvps WHERE id = ?').get(Number(m[2]));
      if (!r) throw new BookingError('This guest is no longer on the list.');
      bookingId = r.booking_id; name = r.child_name;
    } else {
      const b = svc.get(Number(m[2]));
      if (!b) throw new BookingError('Party not found.');
      bookingId = b.id; name = b.child_name || b.parent_name;
    }
    const b = svc.get(bookingId);
    const today = svc.todayLocal();
    const r = checkIn(bookingId, name, 'qr');
    const person = r.people.find((p) => p.key === key(name));
    return { name, person, roster: r, wrongDay: b.party_date !== today ? b.party_date : null };
  }

  /** Today's parties at a location, for the check-in picker. */
  function partiesOn(date, locationId) {
    return svc.list({ from: date, to: date, locationId }).filter((b) => ['confirmed', 'paid'].includes(b.status))
      .map((b) => ({ id: b.id, child: b.child_name, parent: b.parent_name, timeLabel: b.timeLabel, endLabel: b.endLabel, kids: b.kids,
        arrived: db.prepare('SELECT COUNT(*) n FROM checkins WHERE booking_id = ?').get(b.id).n }));
  }

  return { roster, checkIn, undo, passForRsvp, passForBooking, scan, partiesOn };
}

module.exports = { createCheckin };
