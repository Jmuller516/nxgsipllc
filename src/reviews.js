// Reviews parents leave after their party. Only shown publicly when the parent allowed it AND staff approved it.
const config = require('./config');
const { BookingError, todayLocal } = require('./bookings');

const clean = (v, max = 1000) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function createReviews(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());

  function canReview(b) {
    return b && ['confirmed', 'paid'].includes(b.status) && b.party_date <= todayLocal(clock(), cfg.business.timezone);
  }

  function forBooking(bookingId) {
    return db.prepare('SELECT * FROM reviews WHERE booking_id = ?').get(bookingId) || null;
  }

  function submit(bookingId, input) {
    const b = svc.get(bookingId);
    if (!canReview(b)) throw new BookingError('Reviews open after your party.');
    const rating = Math.round(Number(input.rating));
    if (!(rating >= 1 && rating <= 5)) throw new BookingError('Please choose 1 to 5 stars.');
    const fields = [rating, clean(input.comment), clean(input.displayName, 60), input.mayPublish ? 1 : 0];
    if (forBooking(bookingId)) {
      db.prepare(`UPDATE reviews SET rating = ?, comment = ?, display_name = ?, may_publish = ?, approved = 0 WHERE booking_id = ?`).run(...fields, bookingId);
    } else {
      db.prepare(`INSERT INTO reviews (rating, comment, display_name, may_publish, booking_id) VALUES (?, ?, ?, ?, ?)`).run(...fields, bookingId);
    }
    const r = forBooking(bookingId);
    return { ...r, googleReviewUrl: rating >= 4 ? cfg.reviews.googleReviewUrl : null };
  }

  function list() {
    return db.prepare(`SELECT r.*, b.ref, b.parent_name, b.party_date, b.child_name FROM reviews r JOIN bookings b ON b.id = r.booking_id ORDER BY r.created_at DESC`).all();
  }

  function setApproved(id, approved) {
    const r = db.prepare('SELECT may_publish FROM reviews WHERE id = ?').get(id);
    if (!r) throw new BookingError('Review not found.');
    if (approved && !r.may_publish) throw new BookingError("This parent didn't give permission to show their review.");
    db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(approved ? 1 : 0, id);
  }

  function publicList() {
    const rows = db.prepare(`SELECT rating, comment, display_name, created_at FROM reviews WHERE approved = 1 AND may_publish = 1 ORDER BY created_at DESC LIMIT 12`).all();
    const all = db.prepare(`SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE approved = 1 AND may_publish = 1`).get();
    return { reviews: rows.map((r) => ({ rating: r.rating, comment: r.comment, name: r.display_name || 'An NXGS parent', date: r.created_at.slice(0, 10) })), count: all.n, average: all.n ? Math.round(all.avg * 10) / 10 : null };
  }

  return { canReview, forBooking, submit, list, setApproved, publicList };
}

module.exports = { createReviews };
