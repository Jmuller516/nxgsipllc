// Waivers, invitations/RSVP, party details, text messages, run sheet, themes, gift cards, referrals and reviews.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/server');
const { toE164 } = require('../src/notifications');

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const party = { packageId: 'allstar', kids: 15, partyDate: '2026-11-28', time: '12:00', parentName: 'Dana Rivera', email: 'dana@example.com', phone: '(516) 555-0101', childName: 'Liam', childAge: 7 };

async function start(at = '2026-11-01T15:00:00Z') {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ADMIN_PASSWORD = 'secret';
  let now = new Date(at);
  const sentEmails = [], sentTexts = [];
  const db = open(':memory:');
  const app = createApp(db, {
    clock: () => now, background: false, baseUrl: 'https://book.nxgs.net',
    emailSender: async (m) => { sentEmails.push(m); return 'e' + sentEmails.length; },
    smsSender: async (m) => { sentTexts.push(m); return 's' + sentTexts.length; },
  });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64'), 'Content-Type': 'application/json' };
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
  /** Book and pay the deposit through the demo checkout. Returns the customer link pieces. */
  const bookAndPay = async (input) => {
    const r = await call('POST', '/api/bookings', input);
    assert.equal(r.status, 200, r.text);
    const u = new URL(r.json.checkoutUrl);
    if (u.pathname.startsWith('/booking/')) return { ref: r.json.ref, t: u.searchParams.get('t'), paidByGift: true };
    const p = await call('POST', u.pathname + u.search);
    assert.equal(p.status, 303);
    const back = new URL(p.headers.get('location'));
    return { ref: r.json.ref, t: back.searchParams.get('t') };
  };
  return { base, app, db, call, auth, bookAndPay, sentEmails, sentTexts, setNow: (iso) => { now = new Date(iso); }, close: () => server.close() };
}

test('waivers: validation, one per child per guardian, valid for a year, editable text', async () => {
  const t = await start();
  try {
    const w = { childName: 'Ava Murphy', guardianName: 'Tara Murphy', guardianEmail: 'tara@example.com', agree: true, typedSignature: 'Tara Murphy', signature: SIG };
    assert.match((await t.call('POST', '/api/waivers', { ...w, typedSignature: 'Someone Else' })).json.error, /Type your full name/);
    assert.match((await t.call('POST', '/api/waivers', { ...w, signature: null })).json.error, /sign in the box/);
    assert.match((await t.call('POST', '/api/waivers', { ...w, agree: false })).json.error, /agree/);
    const ok = await t.call('POST', '/api/waivers', w);
    assert.equal(ok.status, 200);
    assert.ok(t.app.guests.findWaiver('TARA@example.com', 'ava murphy'), 'lookup ignores case');
    t.setNow('2027-11-02T15:00:00Z');
    assert.equal(t.app.guests.findWaiver('tara@example.com', 'Ava Murphy'), null, 'expires after a year');

    const before = (await t.call('GET', '/api/waiver')).json;
    assert.equal(before.isSample, true);
    const saved = await t.call('PUT', '/api/admin/waiver-text', { text: 'NXGS official waiver. '.repeat(10) }, t.auth);
    assert.equal(saved.json.isSample, false);
    assert.notEqual(saved.json.version, before.version);
    const detail = await t.call('GET', `/api/admin/waivers/${ok.json.id}`, null, t.auth);
    assert.match(detail.json.signatureImage, /^data:image\/png;base64,/);
  } finally { t.close(); }
});

test('invitations: guests RSVP, sign waivers, and the host sees who still needs one', async () => {
  const t = await start();
  try {
    const { ref, t: tok } = await t.bookAndPay({ ...party, theme: 'soccer' });
    const view = (await t.call('GET', `/api/bookings/${ref}?t=${tok}`)).json;
    const inv = view.inviteToken;
    const page = await t.call('GET', `/invite/${inv}`);
    assert.match(page.text, new RegExp(`const TOKEN = "${inv}"`));
    const info = (await t.call('GET', `/api/invite/${inv}`)).json;
    assert.equal(info.childName, 'Liam');
    assert.equal(info.theme.id, 'soccer');
    assert.equal(info.hostFirstName, 'Dana');
    assert.ok(!('email' in info), 'guests never see the host email');

    const r1 = await t.call('POST', `/api/invite/${inv}/rsvp`, { childName: 'Noah Patel', parentName: 'Chris Patel', email: 'chris@example.com', attending: 'yes', allergies: 'Peanuts' });
    assert.equal(r1.json.waiverOnFile, false);
    await t.call('POST', `/api/invite/${inv}/rsvp`, { childName: 'Mia Kim', parentName: 'Rob Kim', attending: 'no' });
    // change of plans: edit the same reply
    const r1b = await t.call('POST', `/api/invite/${inv}/rsvp`, { rsvpToken: r1.json.rsvpToken, childName: 'Noah Patel', parentName: 'Chris Patel', email: 'chris@example.com', attending: 'yes', allergies: 'Peanuts, tree nuts' });
    assert.equal(r1b.json.rsvpToken, r1.json.rsvpToken);

    let g = (await t.call('GET', `/api/bookings/${ref}?t=${tok}`)).json.guests;
    assert.equal(g.yes, 1);
    assert.equal(g.no, 1);
    assert.deepEqual(g.missingWaivers.sort(), ['Liam', 'Noah Patel']);
    assert.equal(g.allergies[0].note, 'Peanuts, tree nuts');

    await t.call('POST', '/api/waivers', { inviteToken: inv, childName: 'Noah Patel', guardianName: 'Chris Patel', guardianEmail: 'chris@example.com', agree: true, typedSignature: 'chris patel', signature: SIG });
    await t.call('POST', '/api/waivers', { inviteToken: inv, childName: 'Liam', guardianName: 'Dana Rivera', guardianEmail: 'dana@example.com', agree: true, typedSignature: 'Dana Rivera', signature: SIG });
    // a walk-in signs at the desk with the party link but never RSVP'd
    await t.call('POST', '/api/waivers', { inviteToken: inv, childName: 'Zoe Santos', guardianName: 'Jess Santos', guardianEmail: 'jess@example.com', agree: true, typedSignature: 'Jess Santos', signature: SIG });
    g = (await t.call('GET', `/api/bookings/${ref}?t=${tok}`)).json.guests;
    assert.equal(g.missingWaivers.length, 0);
    assert.equal(g.waiversSigned, 3);
    assert.ok(g.guests.find((x) => x.childName === 'Zoe Santos').walkIn);

    // Noah's waiver is reused for another party
    const second = await t.bookAndPay({ ...party, partyDate: '2026-12-05', email: 'other@example.com', childName: 'Ella' });
    const inv2 = (await t.call('GET', `/api/bookings/${second.ref}?t=${second.t}`)).json.inviteToken;
    const again = await t.call('POST', `/api/invite/${inv2}/rsvp`, { childName: 'noah patel', parentName: 'Chris Patel', email: 'Chris@Example.com', attending: 'yes' });
    assert.equal(again.json.waiverOnFile, true);

    // unpaid holds have no live invitation
    const hold = await t.call('POST', '/api/bookings', { ...party, partyDate: '2026-12-12', email: 'x@example.com' });
    const holdRef = hold.json.ref;
    const holdTok = new URL(hold.json.checkoutUrl).searchParams.get('t');
    assert.equal((await t.call('GET', `/api/bookings/${holdRef}?t=${holdTok}`)).json.inviteToken, null);
  } finally { t.close(); }
});

test('party details: what is needed depends on the add-ons; photo upload; completeness', async () => {
  const t = await start();
  try {
    const { ref, t: tok } = await t.bookAndPay({ ...party, addOns: { shirts: 4, scoreboard: 1, 'jersey-bag': 12 } });
    let v = (await t.call('GET', `/api/bookings/${ref}?t=${tok}`)).json;
    assert.equal(v.detailsStatus.needs.shirtSizes, 4);
    assert.ok(v.detailsStatus.needs.photo);
    assert.ok(v.detailsStatus.needs.jerseyNumber);
    assert.equal(v.detailsStatus.complete, false);
    assert.ok(v.detailsStatus.missing.includes('sport theme'));

    assert.match((await t.call('POST', `/api/bookings/${ref}/details?t=${tok}`, { theme: 'curling' })).json.error, /theme/);
    assert.match((await t.call('POST', `/api/bookings/${ref}/details?t=${tok}`, { jerseyNumber: '123' })).json.error, /0 to 99/);

    v = (await t.call('POST', `/api/bookings/${ref}/details?t=${tok}`, { theme: 'baseball', childName: 'Liam R.', childAge: 8, allergies: 'none', jerseyNumber: '7', shirtSizes: { YS: 2, YM: 1 } })).json;
    assert.deepEqual(v.detailsStatus.missing, ['shirt sizes for all 4 shirts', 'photo of the birthday child']);
    v = (await t.call('POST', `/api/bookings/${ref}/details?t=${tok}`, { shirtSizes: { YS: 2, YM: 1, AL: 1, BOGUS: 3 }, photoDataUrl: SIG })).json;
    assert.equal(v.detailsStatus.complete, true);
    assert.equal(v.childName, 'Liam R.');
    assert.equal(v.themeInfo.name, 'Baseball');
    assert.deepEqual(v.details.shirtSizes, { YS: 2, YM: 1, AL: 1 });
    assert.equal((await t.call('GET', v.details.photo)).headers.get('content-type'), 'image/png');
    assert.equal((await t.call('POST', `/api/bookings/${ref}/details?t=wrong`, { theme: 'soccer' })).status, 404);
  } finally { t.close(); }
});

test('MVP includes a printed shirt for every child (plus any extra shirts added on)', async () => {
  const t = await start();
  try {
    const { ref, t: tok } = await t.bookAndPay({ ...party, packageId: 'mvp', kids: 18, addOns: { shirts: 2 } });
    const v = (await t.call('GET', `/api/bookings/${ref}?t=${tok}`)).json;
    assert.equal(v.detailsStatus.needs.shirtSizes, 20);
    assert.ok(v.detailsStatus.missing.includes('shirt sizes for all 20 shirts'));
    await t.app.notifier.flush();
    assert.ok(t.sentEmails.some((e) => /shirt sizes/.test(e.html)));
  } finally { t.close(); }
});

test('text messages go only to families who opted in', async () => {
  assert.equal(toE164('(516) 555-0101'), '+15165550101');
  assert.equal(toE164('1-516-555-0101'), '+15165550101');
  assert.equal(toE164('555-0101'), null);
  const t = await start();
  try {
    await t.bookAndPay({ ...party, smsOptIn: true });
    await t.bookAndPay({ ...party, partyDate: '2026-12-05', email: 'nosms@example.com' });
    await t.app.notifier.flush();
    assert.equal(t.sentTexts.length, 1);
    assert.equal(t.sentTexts[0].to, '+15165550101');
    assert.match(t.sentTexts[0].body, /^NXGS: Liam's party is booked .* Reply STOP to opt out\.$/);

    // balance reminder (3 days before Nov 21 due date) and party-tomorrow texts
    t.setNow('2026-11-18T15:00:00Z');
    await t.app.notifier.tick();
    t.setNow('2026-11-27T20:00:00Z');
    await t.app.notifier.tick();
    assert.equal(t.sentTexts.length, 3);
    assert.match(t.sentTexts[1].body, /balance .* is due/);
    assert.match(t.sentTexts[2].body, /See you tomorrow .* waiver/);
    const msgs = (await t.call('GET', '/api/admin/emails', null, t.auth)).json;
    assert.equal(msgs.smsEnabled, true);
    assert.equal(msgs.emails.filter((m) => m.channel === 'sms').length, 3);
  } finally { t.close(); }
});

test('run sheet: one page per day with host, allergies, missing waivers and deliveries', async () => {
  const t = await start();
  try {
    const { ref, t: tok } = await t.bookAndPay({ ...party, theme: 'soccer', addOns: { pizza: 2, shirts: 2 } });
    const id = t.app.svc.getByRef(ref).id;
    await t.call('PATCH', `/api/admin/bookings/${id}`, { hostName: 'Coach Mike' }, t.auth);
    await t.call('POST', `/api/bookings/${ref}/details?t=${tok}`, { allergies: 'Liam: dairy', shirtSizes: { YM: 2 } });
    const inv = t.app.svc.get(id).invite_token;
    await t.call('POST', `/api/invite/${inv}/rsvp`, { childName: 'Noah', parentName: 'Chris', email: 'c@example.com', attending: 'yes', allergies: 'none' });
    const sheet = (await t.call('GET', '/api/admin/runsheet?date=2026-11-28', null, t.auth)).json;
    assert.equal(sheet.parties.length, 1);
    const p = sheet.parties[0];
    assert.equal(p.host, 'Coach Mike');
    assert.equal(p.theme.name, 'Soccer');
    assert.deepEqual(p.guests.missingWaivers, ['Liam', 'Noah']);
    assert.deepEqual(p.guests.allergies.map((a) => a.note), ['Liam: dairy'], '"none" is not listed as an allergy');
    assert.match(sheet.deliveries['Calabria Pizza (North Bellmore)'][0], /Extra pizza pie × 2 for Liam/);
    assert.ok(sheet.deliveries['Lifestyles Sports (Wantagh)']);
    assert.equal((await t.call('GET', '/admin/runsheet')).status, 401);
  } finally { t.close(); }
});

test('gift cards: buy, redeem in full or in part, release on expiry, pay a balance', async () => {
  const t = await start();
  try {
    // buy one (demo checkout)
    const buy = await t.call('POST', '/api/gift-cards', { amountCents: 25000, buyerName: 'Grandma Jo', buyerEmail: 'jo@example.com', recipientName: 'Liam', recipientEmail: 'dana@example.com', message: 'Have fun!' });
    assert.equal(buy.status, 200, buy.text);
    const u = new URL(buy.json.checkoutUrl);
    const code = u.searchParams.get('code');
    assert.match((await t.call('GET', `/api/gift-cards/balance?code=${code}`)).json.error, /couldn't find/, 'not usable before it is paid');
    await t.call('POST', u.pathname + u.search);
    assert.equal((await t.call('GET', `/api/gift-cards/balance?code=${code}`)).json.balanceCents, 25000);
    await t.app.notifier.flush();
    assert.ok(t.sentEmails.some((m) => m.to === 'dana@example.com' && m.html.includes(code)));
    assert.ok(t.sentEmails.some((m) => m.to === 'jo@example.com' && /Your \$250\.00 gift card/.test(m.subject)));

    // $250 covers a Rookie deposit entirely: no card payment needed
    const q = (await t.call('POST', '/api/quote', { ...party, packageId: 'rookie', code })).json;
    assert.equal(q.dueTodayCents, 0);
    const full = await t.bookAndPay({ ...party, packageId: 'rookie', code });
    assert.ok(full.paidByGift);
    let b = t.app.svc.getByRef(full.ref);
    assert.equal(b.status, 'confirmed');
    const left = (await t.call('GET', `/api/gift-cards/balance?code=${code}`)).json.balanceCents;
    assert.equal(left, 25000 - b.deposit_cents);

    // the rest covers part of a bigger deposit; the card pays the remainder
    const big = { ...party, packageId: 'mvp', kids: 20, partyDate: '2026-12-05', email: 'big@example.com', code, addOns: { 'bounce-house': 1 } };
    const bq = (await t.call('POST', '/api/quote', big)).json;
    assert.equal(bq.gift.applyCents, left);
    const created = await t.call('POST', '/api/bookings', big);
    const cu = new URL(created.json.checkoutUrl);
    assert.equal(Number(cu.searchParams.get('amount')), bq.depositCents - left);
    assert.equal((await t.call('GET', `/api/gift-cards/balance?code=${code}`)).json.balanceCents, 0, 'held while paying');
    await t.call('POST', cu.pathname + cu.search);
    b = t.app.svc.getByRef(created.json.ref);
    assert.equal(b.paid_cents, bq.depositCents);
    assert.deepEqual(t.app.svc.payments(b.id).map((p) => p.method), ['gift_card', 'demo']);
    await t.app.notifier.flush();
    assert.equal(t.sentEmails.filter((m) => m.to === 'big@example.com' && /Party confirmed/.test(m.subject)).length, 1);
    assert.equal(t.sentEmails.filter((m) => m.to === 'big@example.com' && /Payment received/.test(m.subject)).length, 0, 'no separate email for the gift-card part');

    // a hold that is never paid gives the money back to the card
    const card2 = t.app.gifts.createManual({ amount: 40, recipientName: 'Test' });
    const abandoned = await t.call('POST', '/api/bookings', { ...party, partyDate: '2026-12-12', email: 'gone@example.com', code: card2.code });
    assert.equal(abandoned.status, 200);
    assert.equal(t.app.gifts.find(card2.code).balanceCents, 0);
    t.setNow('2026-11-01T16:00:00Z');
    t.app.svc.expireHolds();
    assert.equal(t.app.gifts.find(card2.code).balanceCents, 4000);

    // pay part of a balance from the booking page
    const r = await t.call('POST', `/api/bookings/${full.ref}/gift-card?t=${full.t}`, { code: card2.code });
    assert.equal(r.json.appliedCents, 4000);
    assert.equal(r.json.booking.paidCents, t.app.svc.getByRef(full.ref).deposit_cents + 4000);
    assert.match((await t.call('POST', `/api/bookings/${full.ref}/gift-card?t=${full.t}`, { code: card2.code })).json.error, /no balance left/);

    // gift card redemptions are not new income in QuickBooks
    assert.equal(t.db.prepare(`SELECT COUNT(*) n FROM qbo_sync s JOIN payments p ON p.id = s.payment_id WHERE p.method = 'gift_card'`).get().n, 0);
    assert.match((await t.call('POST', '/api/quote', { ...party, code: 'NOPE-1234' })).json.error, /couldn't find that code/);
  } finally { t.close(); }
});

test('referrals: friend gets a discount, the referring family gets party credit once', async () => {
  const t = await start();
  try {
    const first = await t.bookAndPay(party);
    const code = (await t.call('GET', `/api/bookings/${first.ref}?t=${first.t}`)).json.referralCode;
    assert.match(code, /^LIAM-[A-Z2-9]{4}$/);
    assert.match((await t.call('POST', '/api/quote', { ...party, partyDate: '2026-12-05', code })).json.error, /own referral code/);

    const friend = { ...party, partyDate: '2026-12-05', parentName: 'Chris Patel', email: 'chris@example.com', childName: 'Noah', code: code.toLowerCase() };
    const q = (await t.call('POST', '/api/quote', friend)).json;
    const disc = q.lines.find((l) => l.kind === 'discount');
    assert.equal(disc.totalCents, -config.referral.friendDiscountCents);
    const normal = (await t.call('POST', '/api/quote', { ...friend, code: undefined })).json;
    assert.equal(normal.subtotalCents - q.subtotalCents, config.referral.friendDiscountCents);
    assert.ok(q.taxCents < normal.taxCents, 'discount comes off before tax');

    const f = await t.bookAndPay(friend);
    const credit = t.db.prepare(`SELECT * FROM gift_cards WHERE kind = 'referral'`).all();
    assert.equal(credit.length, 1);
    assert.equal(credit[0].recipient_email, 'dana@example.com');
    assert.equal(credit[0].initial_cents, config.referral.referrerCreditCents);
    // a second payment by the friend doesn't issue another credit
    const fb = t.app.svc.getByRef(f.ref);
    t.app.svc.recordPayment(fb.id, { kind: 'balance', method: 'cash', amountCents: 1000 });
    assert.equal(t.db.prepare(`SELECT COUNT(*) n FROM gift_cards WHERE kind = 'referral'`).get().n, 1);
    await t.app.notifier.flush();
    assert.ok(t.sentEmails.some((m) => m.to === 'dana@example.com' && /party credit/.test(m.subject) && m.html.includes(credit[0].code)));
  } finally { t.close(); }
});

test('reviews: requested the day after, private unless allowed and approved', async () => {
  const t = await start();
  try {
    const b = await t.bookAndPay(party);
    assert.match((await t.call('POST', `/api/bookings/${b.ref}/review?t=${b.t}`, { rating: 5 })).json.error, /after your party/);
    t.setNow('2026-11-29T15:00:00Z');
    await t.app.notifier.tick();
    assert.ok(t.sentEmails.some((m) => /How was Liam's party/.test(m.subject)));
    assert.equal((await t.call('GET', `/api/bookings/${b.ref}?t=${b.t}`)).json.canReview, true);
    const r = await t.call('POST', `/api/bookings/${b.ref}/review?t=${b.t}`, { rating: 5, comment: 'Amazing!', displayName: 'Dana R.', mayPublish: true });
    assert.equal(r.status, 400, 'too short');
    assert.match(r.json.error, /at least 100 characters/);
    const spam = await t.call('POST', `/api/bookings/${b.ref}/review?t=${b.t}`, { rating: 5, comment: 'great '.repeat(20), mayPublish: true });
    assert.equal(spam.status, 400, 'long but repetitive');
    assert.equal((await t.call('POST', `/api/bookings/${b.ref}/review?t=${b.t}`, { rating: 0, comment: 'Liam had a fantastic time. The staff were friendly, the kids loved the field games and the video game room, and the food came out right on time.' })).status, 400, 'needs a star rating');
    assert.equal((await t.call('POST', `/api/bookings/${b.ref}/review?t=WRONG`, { rating: 5, comment: 'Liam had a fantastic time. The staff were friendly, the kids loved the field games and the video game room, and the food came out right on time.' })).status, 404, 'needs the booking link');
    const ok = await t.call('POST', `/api/bookings/${b.ref}/review?t=${b.t}`, { rating: 5, comment: 'Liam had a fantastic time. The staff were friendly, the kids loved the field games and the video game room, and the food came out right on time.', displayName: 'Dana R.', mayPublish: true });
    assert.equal(ok.status, 200);
    assert.equal((await t.call('GET', '/api/reviews')).json.count, 0, 'hidden until staff approve');
    const list = (await t.call('GET', '/api/admin/reviews', null, t.auth)).json;
    await t.call('POST', `/api/admin/reviews/${list[0].id}`, { approved: true }, t.auth);
    const pub = (await t.call('GET', '/api/reviews')).json;
    assert.equal(pub.count, 1);
    assert.equal(pub.reviews[0].name, 'Dana R.');
    assert.ok(!JSON.stringify(pub).includes('dana@example.com'));

    const priv = await t.bookAndPay({ ...party, partyDate: '2026-12-05', email: 'p@example.com' });
    t.setNow('2026-12-06T15:00:00Z');
    await t.call('POST', `/api/bookings/${priv.ref}/review?t=${priv.t}`, { rating: 3, comment: 'Liam had a fantastic time. The staff were friendly, the kids loved the field games and the video game room, and the food came out right on time.', mayPublish: false });
    const id = (await t.call('GET', '/api/admin/reviews', null, t.auth)).json.find((x) => x.rating === 3).id;
    assert.match((await t.call('POST', `/api/admin/reviews/${id}`, { approved: true }, t.auth)).json.error, /permission/);
  } finally { t.close(); }
});

test('details reminder goes out 10 days before the party if anything is missing', async () => {
  const t = await start();
  try {
    await t.bookAndPay(party);
    t.setNow('2026-11-17T15:00:00Z');
    await t.app.notifier.tick();
    assert.equal(t.sentEmails.filter((m) => /A few details needed/.test(m.subject)).length, 0);
    t.setNow('2026-11-18T15:00:00Z');
    await t.app.notifier.tick();
    const m = t.sentEmails.find((x) => /A few details needed/.test(x.subject));
    assert.ok(m);
    assert.match(m.html, /sport theme/);
  } finally { t.close(); }
});

test('parent portal: access code in the confirmation email opens the party page', async () => {
  const t = await start();
  try {
    const b = await t.bookAndPay(party);
    await t.app.notifier.flush();
    const conf = t.sentEmails.find((m) => /Party confirmed/.test(m.subject));
    const code = /\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(conf.html.replace(/<[^>]+>/g, ' '))?.[1];
    assert.ok(code, 'confirmation email carries a code');
    assert.match(conf.html, /\/my-party/);
    assert.equal((await t.call('GET', `/api/bookings/${b.ref}?t=${b.t}`)).json.accessCode, code);
    const page = await t.call('GET', '/my-party');
    assert.equal(page.status, 200);
    assert.match(page.text, /Open your party page|portal\/login/);

    const login = await t.call('POST', '/api/portal/login', { email: ' DANA@example.com ', code: code.toLowerCase().replace('-', ' ') });
    assert.equal(login.status, 200);
    assert.equal(login.json.url, `/booking/${b.ref}?t=${b.t}`);
    assert.equal((await t.call('POST', '/api/portal/login', { email: 'someone@else.com', code })).status, 400, 'wrong email');
    assert.equal((await t.call('POST', '/api/portal/login', { email: 'dana@example.com', code: 'AAAA-AAAA' })).status, 400, 'wrong code');
  } finally { t.close(); }
});

test('parent portal: "email me my code" re-sends it and does not reveal who has booked', async () => {
  const t = await start();
  try {
    const b = await t.bookAndPay(party);
    const before = t.sentEmails.length;
    const code = (await t.call('GET', `/api/bookings/${b.ref}?t=${b.t}`)).json.accessCode;
    assert.equal((await t.call('POST', '/api/portal/resend', { email: 'nobody@example.com' })).status, 200);
    assert.equal((await t.call('POST', '/api/portal/resend', { email: 'dana@example.com' })).status, 200);
    await t.app.notifier.flush();
    const sent = t.sentEmails.slice(before).filter((m) => m.to === 'dana@example.com' && /party page code/i.test(m.subject));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].html.includes(code));
    assert.ok(!t.sentEmails.some((m) => m.to === 'nobody@example.com'));
    // asking twice in the same hour doesn't send twice
    await t.call('POST', '/api/portal/resend', { email: 'dana@example.com' });
    await t.app.notifier.flush();
    assert.equal(t.sentEmails.filter((m) => /party page code/i.test(m.subject)).length, 1);
  } finally { t.close(); }
});

test('party page: calendar file, directions and the "before you come" tips', async () => {
  const t = await start();
  try {
    const b = await t.bookAndPay(party);
    await t.call('PUT', '/api/admin/site', { goodToKnow: 'Parking is free behind the building.\n\nWear sneakers.' }, t.auth);
    const v = (await t.call('GET', `/api/bookings/${b.ref}?t=${b.t}`)).json;
    assert.deepEqual(v.goodToKnow, ['Parking is free behind the building.', 'Wear sneakers.']);
    assert.match(v.mapUrl, /google\.com\/maps/);
    assert.match(v.calendar.googleUrl, /calendar\.google\.com.*dates=20261128T120000/);
    const ics = await fetch(`${t.base}${v.calendar.icsUrl}`);
    assert.equal(ics.status, 200);
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    const body = await ics.text();
    assert.match(body, /DTSTART;TZID=America\/New_York:20261128T120000/);
    assert.match(body, /SUMMARY:Liam's party/);
    assert.equal((await fetch(`${t.base}/booking/${b.ref}/calendar.ics?t=nope`)).status, 404);
  } finally { t.close(); }
});

test('reminders: "one week to go" lists what is left, once, and skips parties booked inside that week', async () => {
  const t = await start();
  try {
    const first = await t.bookAndPay(party);   // 2026-11-28, booked 2026-11-01
    t.db.prepare("UPDATE bookings SET created_at = '2026-11-01 10:00:00' WHERE ref = ?").run(first.ref);
    t.setNow('2026-11-20T15:00:00Z');
    await t.app.notifier.tick();
    assert.equal(t.sentEmails.filter((m) => /One week to go/.test(m.subject)).length, 0, 'too early');
    t.setNow('2026-11-21T15:00:00Z');
    await t.app.notifier.tick(); await t.app.notifier.tick();
    const w = t.sentEmails.filter((m) => /One week to go/.test(m.subject));
    assert.equal(w.length, 1);
    assert.match(w[0].html, /Pay the \$/);
    assert.match(w[0].html, /Send the invitation link/);

    const late = await t.bookAndPay({ ...party, time: '16:00', email: 'late@example.com' });   // booked 7 days out, same Saturday
    t.db.prepare("UPDATE bookings SET created_at = '2026-11-21 10:00:00' WHERE ref = ?").run(late.ref);   // the test clock does not drive created_at
    await t.app.notifier.tick();
    assert.equal(t.sentEmails.filter((m) => /One week to go/.test(m.subject) && m.to === 'late@example.com').length, 0);
  } finally { t.close(); }
});

test('thank-you: a week after the party, one email with a party-credit code that works at checkout', async () => {
  const t = await start();
  try {
    await t.bookAndPay(party);
    t.setNow('2026-12-04T15:00:00Z');
    await t.app.notifier.tick();
    assert.equal(t.sentEmails.filter((m) => /gift for your next party/.test(m.subject)).length, 0, 'day 6');
    t.setNow('2026-12-05T15:00:00Z');
    await t.app.notifier.tick(); await t.app.notifier.tick();
    const m = t.sentEmails.filter((x) => /gift for your next party/.test(x.subject));
    assert.equal(m.length, 1);
    const code = /NXGC-[A-Z0-9-]+/.exec(m[0].html)?.[0];
    assert.ok(code, 'email carries the credit code');
    assert.match(m[0].html, /\$25\.00/);
    assert.match(m[0].html, new RegExp(`/book\\?code=${code}`));
    const card = (await t.call('GET', '/api/admin/gift-cards', null, t.auth)).json;
    assert.ok(JSON.stringify(card).includes(code));
  } finally { t.close(); }
});

test('thank-you: no gift when the family already booked another party', async () => {
  const t = await start();
  try {
    await t.bookAndPay(party);
    await t.bookAndPay({ ...party, partyDate: '2027-01-16', time: '16:00' });   // same parent, next party
    t.setNow('2026-12-05T15:00:00Z');
    await t.app.notifier.tick();
    assert.equal(t.sentEmails.filter((m) => /gift for your next party/.test(m.subject)).length, 0);
  } finally { t.close(); }
});
