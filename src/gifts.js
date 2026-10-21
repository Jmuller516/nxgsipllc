// Gift cards (bought online or issued by staff) and referral credits (issued automatically).
// A referral credit is simply a gift card with kind 'referral'.
const crypto = require('node:crypto');
const config = require('./config');
const { money } = require('./pricing');
const { BookingError } = require('./bookings');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function createGifts(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const hooks = opts.hooks || {};
  const fire = (name, ...args) => { for (const h of [].concat(hooks[name] || [])) { try { h(...args); } catch (e) { console.error(`${name} hook failed:`, e); } } };

  function makeCode(prefix) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 10; i++) {
      let s = '';
      for (const x of crypto.randomBytes(8)) s += alphabet[x % alphabet.length];
      const code = `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
      if (!db.prepare('SELECT 1 FROM gift_cards WHERE code = ?').get(code)) return code;
    }
    throw new Error('Could not create a unique code');
  }

  function balanceOf(cardId) {
    const card = db.prepare('SELECT initial_cents FROM gift_cards WHERE id = ?').get(cardId);
    const spent = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) s FROM gift_card_uses WHERE gift_card_id = ? AND status IN ('held','used')`).get(cardId).s;
    return Math.max(0, (card?.initial_cents || 0) - spent);
  }

  function find(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    const card = db.prepare(`SELECT * FROM gift_cards WHERE code = ?`).get(c);
    if (!card) return null;
    return { ...card, balanceCents: balanceOf(card.id) };
  }

  /** What a gift card would cover on an amount due. Throws a friendly error for a used-up or inactive card. */
  function preview(code, dueCents) {
    const card = find(code);
    if (!card) return null;
    if (card.status !== 'active') throw new BookingError('That gift card is not active.');
    if (card.balanceCents <= 0) throw new BookingError('That gift card has no balance left.');
    return { code: card.code, kind: card.kind, balanceCents: card.balanceCents, applyCents: Math.min(card.balanceCents, dueCents) };
  }

  /** Reserve gift card money for a new booking while the customer pays the rest by card. */
  function hold(code, bookingId, cents) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const card = find(code);
      if (!card || card.status !== 'active' || card.balanceCents < cents) throw new BookingError('That gift card no longer covers this amount.');
      db.prepare(`INSERT INTO gift_card_uses (gift_card_id, booking_id, amount_cents, status) VALUES (?, ?, ?, 'held')`).run(card.id, bookingId, cents);
      db.exec('COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  }

  function heldFor(bookingId) {
    return db.prepare(`SELECT u.*, g.code FROM gift_card_uses u JOIN gift_cards g ON g.id = u.gift_card_id WHERE u.booking_id = ? AND u.status = 'held'`).all(bookingId);
  }

  /** The card payment went through: turn held gift money into a real payment on the booking. */
  function commitHeld(bookingId, { split = true } = {}) {
    for (const u of heldFor(bookingId)) {
      db.prepare(`UPDATE gift_card_uses SET status = 'used' WHERE id = ?`).run(u.id);
      const b = svc.get(bookingId);
      svc.recordPayment(bookingId, { kind: b.paid_cents === 0 ? 'deposit' : 'balance', method: 'gift_card', amountCents: u.amount_cents, note: `Gift card ${u.code}${split ? ' [split]' : ''}` });
    }
  }

  function releaseHeld(bookingId) {
    db.prepare(`UPDATE gift_card_uses SET status = 'released' WHERE booking_id = ? AND status = 'held'`).run(bookingId);
  }

  /** Pay (part of) a booking's balance with a gift card, right away. */
  function applyToBalance(bookingId, code) {
    const b = svc.get(bookingId);
    if (!b || !['confirmed'].includes(b.status) || b.balanceCents <= 0) throw new BookingError('There is no balance to pay on this booking.');
    const p = preview(code, b.balanceCents);
    if (!p) throw new BookingError("We couldn't find that gift card code.");
    const card = find(code);
    db.prepare(`INSERT INTO gift_card_uses (gift_card_id, booking_id, amount_cents, status) VALUES (?, ?, ?, 'used')`).run(card.id, bookingId, p.applyCents);
    svc.recordPayment(bookingId, { kind: 'balance', method: 'gift_card', amountCents: p.applyCents, note: `Gift card ${card.code}` });
    return { appliedCents: p.applyCents, remainingOnCard: balanceOf(card.id) };
  }

  // ---------- buying a gift card ----------
  function createPending(input) {
    const cents = Math.round(Number(input.amountCents));
    if (!Number.isFinite(cents) || cents < cfg.giftCards.minCents || cents > cfg.giftCards.maxCents) {
      throw new BookingError(`Gift cards can be ${money(cfg.giftCards.minCents)} to ${money(cfg.giftCards.maxCents)}.`);
    }
    const buyerName = clean(input.buyerName, 120), buyerEmail = clean(input.buyerEmail, 200)?.toLowerCase();
    const recipientName = clean(input.recipientName, 120), recipientEmail = clean(input.recipientEmail, 200)?.toLowerCase() || null;
    if (!buyerName || !buyerEmail || !EMAIL.test(buyerEmail)) throw new BookingError('Please enter your name and a valid email.');
    if (!recipientName) throw new BookingError("Please enter who the gift card is for.");
    if (recipientEmail && !EMAIL.test(recipientEmail)) throw new BookingError("Please check the recipient's email.");
    const info = db.prepare(`INSERT INTO gift_cards (code, kind, status, initial_cents, buyer_name, buyer_email, recipient_name, recipient_email, message)
      VALUES (?, 'purchase', 'pending', ?, ?, ?, ?, ?, ?)`).run(makeCode('NXGC'), cents, buyerName, buyerEmail, recipientName, recipientEmail, clean(input.message, 300));
    return db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(Number(info.lastInsertRowid));
  }

  function activate(cardId) {
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
    if (!card || card.status !== 'pending') return card;
    db.prepare(`UPDATE gift_cards SET status = 'active', activated_at = datetime('now') WHERE id = ?`).run(cardId);
    const active = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
    fire('onGiftActivated', active);
    return active;
  }

  function createManual(input) {
    const cents = Math.round(Number(input.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > 500000) throw new BookingError('Enter an amount.');
    const recipientName = clean(input.recipientName, 120);
    if (!recipientName) throw new BookingError('Enter who it is for.');
    const email = clean(input.recipientEmail, 200)?.toLowerCase() || null;
    if (email && !EMAIL.test(email)) throw new BookingError('Check the email address.');
    const info = db.prepare(`INSERT INTO gift_cards (code, kind, status, initial_cents, recipient_name, recipient_email, message, activated_at)
      VALUES (?, 'manual', 'active', ?, ?, ?, ?, datetime('now'))`).run(makeCode('NXGC'), cents, recipientName, email, clean(input.message, 300));
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(Number(info.lastInsertRowid));
    if (email && input.sendEmail) fire('onGiftActivated', card);
    return card;
  }

  function voidCard(id) {
    db.prepare(`UPDATE gift_cards SET status = 'void' WHERE id = ?`).run(id);
  }

  function list() {
    return db.prepare('SELECT * FROM gift_cards ORDER BY id DESC LIMIT 300').all().map((c) => ({ ...c, balanceCents: balanceOf(c.id) }));
  }

  // ---------- referral credits ----------
  /** When a referred family's party is confirmed, the family who referred them gets a credit (once). */
  function onPayment(booking, payment) {
    if (!booking.referred_by) return;
    if (payment.method === 'gift_card') return; // the family must actually pay something first
    if (db.prepare(`SELECT 1 FROM gift_cards WHERE kind = 'referral' AND source_booking_id = ?`).get(booking.id)) return;
    const referrer = svc.get(booking.referred_by);
    if (!referrer) return;
    const info = db.prepare(`INSERT INTO gift_cards (code, kind, status, initial_cents, recipient_name, recipient_email, message, source_booking_id, activated_at)
      VALUES (?, 'referral', 'active', ?, ?, ?, ?, ?, datetime('now'))`).run(
      makeCode('NXRF'), cfg.referral.referrerCreditCents, referrer.parent_name, referrer.email,
      `Thanks for referring ${String(booking.parent_name || '').split(' ')[0] || 'a friend'}!`, booking.id);
    fire('onReferralCredit', db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(Number(info.lastInsertRowid)), referrer);
  }

  return { find, preview, hold, heldFor, commitHeld, releaseHeld, applyToBalance, createPending, activate, createManual, voidCard, list, onPayment, balanceOf };
}

module.exports = { createGifts };
