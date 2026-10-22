// Party guests: invitation RSVPs and signed liability waivers.
const crypto = require('node:crypto');
const config = require('./config');
const media = require('./media');
const { BookingError } = require('./bookings');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function createGuests(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const audience = opts.audience || null;
  const langOf = (l) => ((cfg.languages || ['en']).includes(l) ? l : 'en');

  // ---------- waiver text ----------
  // A Spanish waiver is used only once staff paste one in (it should come from your attorney too);
  // until then Spanish-speaking families see the English waiver with a note.
  function waiverText(lang = 'en') {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'waiver_text'").get();
    const es = lang === 'es' ? db.prepare("SELECT value FROM settings WHERE key = 'waiver_text_es'").get() : null;
    const text = es ? JSON.parse(es.value) : row ? JSON.parse(row.value) : cfg.waiver.sampleText;
    const version = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    return { title: cfg.waiver.title, text, version, isSample: !row, validDays: cfg.waiver.validDays, lang: es ? 'es' : 'en', translationMissing: lang === 'es' && !es };
  }

  function setWaiverText(text, lang = 'en') {
    const t = String(text || '').replace(/\r/g, '').trim();
    const k = lang === 'es' ? 'waiver_text_es' : 'waiver_text';
    if (lang === 'es' && !t) { db.prepare("DELETE FROM settings WHERE key = 'waiver_text_es'").run(); return waiverText(); }
    if (t.length < 50) throw new BookingError('The waiver text looks too short.');
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(k, JSON.stringify(t.slice(0, 20000)));
    return waiverText();
  }
  function spanishWaiver() {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'waiver_text_es'").get();
    return r ? JSON.parse(r.value) : '';
  }

  // ---------- waivers ----------
  /** A current waiver on file for this child from this guardian, or null. */
  function findWaiver(email, childName) {
    if (!email || !childName) return null;
    return db.prepare(`SELECT id, child_name, guardian_name, signed_at, expires_at FROM waivers
      WHERE lower(guardian_email) = ? AND lower(child_name) = ? AND expires_at > ? ORDER BY signed_at DESC LIMIT 1`)
      .get(norm(email), norm(childName), clock().toISOString()) || null;
  }

  function signWaiver(input, { ip, userAgent } = {}) {
    const childName = clean(input.childName, 120);
    const guardianName = clean(input.guardianName, 120);
    const email = clean(input.guardianEmail, 200)?.toLowerCase();
    const typed = clean(input.typedSignature, 120);
    if (!childName || !guardianName) throw new BookingError("Please enter the child's name and your name.");
    if (!email || !EMAIL.test(email)) throw new BookingError('Please enter a valid email.');
    if (!input.agree) throw new BookingError('Please check the box to agree to the waiver.');
    if (!typed || norm(typed) !== norm(guardianName)) throw new BookingError('Type your full name exactly as above to sign.');
    if (!input.signature) throw new BookingError('Please sign in the box with your finger or mouse.');
    if (input.childBirthdate && !/^\d{4}-\d{2}-\d{2}$/.test(input.childBirthdate)) throw new BookingError('Please enter a valid birth date.');

    let bookingId = null;
    if (input.inviteToken) bookingId = svc.getByInvite(input.inviteToken)?.id || null;

    const { version } = waiverText(langOf(input.lang));
    let sigPath;
    try { sigPath = media.saveDataUrl(db, input.signature, { maxBytes: 400_000, label: 'signature' }); } catch (e) { throw new BookingError(e.message); }
    const now = clock();
    const expires = new Date(now.getTime() + cfg.waiver.validDays * 86400000);
    const info = db.prepare(`INSERT INTO waivers (waiver_version, booking_id, child_name, child_birthdate, guardian_name, guardian_email, guardian_phone,
      emergency_name, emergency_phone, medical_notes, typed_signature, signature_media, ip, user_agent, signed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      version, bookingId, childName, clean(input.childBirthdate, 10), guardianName, email, clean(input.guardianPhone, 40),
      clean(input.emergencyName, 120), clean(input.emergencyPhone, 40), clean(input.medicalNotes, 1000), typed, sigPath,
      clean(ip, 64), clean(userAgent, 300), now.toISOString(), expires.toISOString());
    if (input.marketingOptIn) {
      db.prepare('UPDATE waivers SET marketing_opt_in = 1 WHERE id = ?').run(Number(info.lastInsertRowid));
      audience?.optIn({ email, name: guardianName, childName, phone: input.guardianPhone, source: 'waiver', bookingId, lang: langOf(input.lang) });
    }
    return { id: Number(info.lastInsertRowid), childName, expiresAt: expires.toISOString() };
  }

  function searchWaivers(q = '') {
    const like = `%${norm(q)}%`;
    return db.prepare(`SELECT w.id, w.child_name, w.guardian_name, w.guardian_email, w.signed_at, w.expires_at, w.waiver_version, b.ref, b.party_date
      FROM waivers w LEFT JOIN bookings b ON b.id = w.booking_id
      WHERE lower(w.child_name) LIKE ? OR lower(w.guardian_name) LIKE ? OR lower(w.guardian_email) LIKE ?
      ORDER BY w.signed_at DESC LIMIT 200`).all(like, like, like)
      .map((w) => ({ ...w, current: w.expires_at > clock().toISOString() }));
  }

  function getWaiver(id) {
    const w = db.prepare('SELECT * FROM waivers WHERE id = ?').get(id);
    if (!w) return null;
    return { ...w, signatureImage: media.asDataUrl(db, w.signature_media) };
  }

  // ---------- RSVPs ----------
  function rsvp(inviteToken, input) {
    const b = svc.getByInvite(inviteToken);
    if (!b || !['confirmed', 'paid'].includes(b.status)) throw new BookingError('This invitation is no longer active.');
    const childName = clean(input.childName, 120);
    const parentName = clean(input.parentName, 120);
    const email = clean(input.email, 200)?.toLowerCase() || null;
    const attending = input.attending === 'no' ? 'no' : 'yes';
    if (!childName || !parentName) throw new BookingError("Please enter your child's name and your name.");
    if (attending === 'yes' && (!email || !EMAIL.test(email))) throw new BookingError('Please enter a valid email so we can send the waiver.');
    if (email && !EMAIL.test(email)) throw new BookingError('Please enter a valid email.');
    const fields = [childName, parentName, email, clean(input.phone, 40), attending, clean(input.allergies, 500)];
    const existing = input.rsvpToken ? db.prepare('SELECT * FROM rsvps WHERE token = ? AND booking_id = ?').get(String(input.rsvpToken), b.id) : null;
    let token;
    if (existing) {
      db.prepare(`UPDATE rsvps SET child_name = ?, parent_name = ?, email = ?, phone = ?, attending = ?, allergies = ?, updated_at = datetime('now') WHERE id = ?`).run(...fields, existing.id);
      token = existing.token;
    } else {
      const yes = db.prepare(`SELECT COUNT(*) n FROM rsvps WHERE booking_id = ?`).get(b.id).n;
      if (yes >= 60) throw new BookingError('This party has a lot of replies already. Please contact the host.');
      token = crypto.randomBytes(12).toString('hex');
      db.prepare(`INSERT INTO rsvps (booking_id, token, child_name, parent_name, email, phone, attending, allergies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(b.id, token, ...fields);
    }
    if (input.marketingOptIn && email) {
      db.prepare('UPDATE rsvps SET marketing_opt_in = 1 WHERE token = ?').run(token);
      audience?.optIn({ email, name: parentName, childName, phone: input.phone, source: 'rsvp', bookingId: b.id, lang: langOf(input.lang) });
    }
    const waiver = attending === 'yes' ? findWaiver(email, childName) : null;
    return { rsvpToken: token, attending, waiverOnFile: !!waiver, waiverExpires: waiver?.expires_at || null };
  }

  /** Everyone coming to a party, with waiver status. Shown to the host and to staff. */
  function partyGuests(bookingId) {
    const b = svc.get(bookingId);
    if (!b) return null;
    const rsvps = db.prepare('SELECT * FROM rsvps WHERE booking_id = ? ORDER BY created_at').all(bookingId);
    const partyWaivers = db.prepare('SELECT id, child_name, guardian_name, guardian_email, medical_notes, signed_at FROM waivers WHERE booking_id = ?').all(bookingId);
    const now = clock().toISOString();
    const guests = rsvps.map((r) => {
      const w = r.attending === 'yes' ? (findWaiver(r.email, r.child_name) || partyWaivers.find((x) => norm(x.child_name) === norm(r.child_name))) : null;
      return { id: r.id, childName: r.child_name, parentName: r.parent_name, email: r.email, phone: r.phone, attending: r.attending, allergies: r.allergies, waiver: !!w, waiverId: w?.id || null, repliedAt: r.updated_at };
    });
    // Waivers signed with this party's link by guests who never RSVP'd (e.g. at the front desk).
    for (const w of partyWaivers) {
      if (norm(w.child_name) === norm(b.child_name)) continue; // the birthday child is counted separately
      if (!guests.some((g) => norm(g.childName) === norm(w.child_name))) {
        guests.push({ id: null, childName: w.child_name, parentName: w.guardian_name, email: w.guardian_email, attending: 'yes', allergies: w.medical_notes, waiver: true, waiverId: w.id, walkIn: true });
      }
    }
    // The birthday child needs a waiver too.
    const bdayWaiver = b.child_name ? findWaiver(b.email, b.child_name) : null;
    const coming = guests.filter((g) => g.attending === 'yes');
    return {
      guests,
      birthdayChild: b.child_name ? { name: b.child_name, waiver: !!bdayWaiver } : null,
      yes: coming.length,
      no: guests.filter((g) => g.attending === 'no').length,
      booked: b.kids,
      waiversSigned: coming.filter((g) => g.waiver).length + (bdayWaiver ? 1 : 0),
      waiversNeeded: coming.length + (b.child_name ? 1 : 0),
      missingWaivers: [...(b.child_name && !bdayWaiver ? [b.child_name] : []), ...coming.filter((g) => !g.waiver).map((g) => g.childName)],
      allergies: [
        ...(b.details?.allergies ? [{ who: b.child_name || 'Birthday child', note: b.details.allergies }] : []),
        ...coming.filter((g) => g.allergies && !/^(none|no|n\/a|na)\.?$/i.test(g.allergies)).map((g) => ({ who: g.childName, note: g.allergies })),
      ],
      now,
    };
  }

  /** What a guest sees on the invitation page (no other guests' details). */
  function invitation(inviteToken) {
    const b = svc.getByInvite(inviteToken);
    if (!b) return null;
    return {
      active: ['confirmed', 'paid'].includes(b.status),
      childName: b.child_name,
      childAge: b.child_age,
      hostFirstName: String(b.parent_name || '').split(' ')[0],
      date: b.party_date,
      timeLabel: b.timeLabel,
      endLabel: b.endLabel,
      theme: b.themeInfo,
      schedule: b.schedule,
      locationId: b.location_id,
      place: { name: b.location.name, address: b.location.address, phone: b.location.phone || cfg.business.phone },
      waiver: waiverText(),
    };
  }

  return { spanishWaiver, waiverText, setWaiverText, findWaiver, signWaiver, searchWaivers, getWaiver, rsvp, partyGuests, invitation };
}

module.exports = { createGuests };
