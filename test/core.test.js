const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const config = require('../src/config');
const scheduling = require('../src/scheduling');
const pricing = require('../src/pricing');
const { open } = require('../src/db');
const { createService } = require('../src/bookings');
const { createApp } = require('../src/server');
const stripe = require('../src/stripe');

const NOON = scheduling.toMinutes('12:00');

test('two parties can run at once but not three', () => {
  assert.equal(scheduling.conflictReason(NOON + 30, [NOON], config), null);
  // a third party overlapping both is refused
  assert.match(scheduling.conflictReason(NOON + 90, [NOON, NOON + 30], config), /Fully booked|game room/i);
});

test('the single video game room is never double-booked', () => {
  // Same start time = same game-room half hour
  assert.match(scheduling.conflictReason(NOON, [NOON], config), /game room/i);
});

test('turnover time is respected', () => {
  // two parties running; the next one can start once one finishes + 15 min cleanup
  const taken = [NOON, NOON + 30];
  assert.ok(scheduling.conflictReason(NOON + 120, taken, config)); // first party still cleaning up
  assert.equal(scheduling.conflictReason(NOON + 150, taken, config), null);
});

test('closed days and closing time', () => {
  // 2026-11-02 is a Monday (closed in default config)
  assert.equal(scheduling.slotsForDate('2026-11-02', [], config).open, false);
  // Saturday 10:00–20:00, 2-hour parties: last start 18:00
  const sat = scheduling.slotsForDate('2026-11-07', [], config);
  assert.equal(sat.slots.at(-1).time, '18:00');
});

test('pricing: extra kids, tax, 25% deposit, balance due 7 days before', () => {
  const q = pricing.quote({ packageId: 'rookie', kids: 18, addOns: { pizza: 2 }, partyDate: '2026-12-12', today: '2026-11-01' }, config);
  const sub = 45000 + 3 * 2500 + 2 * 2200;
  assert.equal(q.subtotalCents, sub);
  assert.equal(q.taxCents, Math.round(sub * config.tax.rate));
  assert.equal(q.depositCents, Math.round(q.totalCents * 0.25));
  assert.equal(q.balanceCents, q.totalCents - q.depositCents);
  assert.equal(q.balanceDueDate, '2026-12-05');
  assert.equal(q.payInFull, false);
});

test('pricing: inside 7 days is paid in full; kid limit enforced', () => {
  const q = pricing.quote({ packageId: 'rookie', kids: 10, partyDate: '2026-11-05', today: '2026-11-01' }, config);
  assert.equal(q.payInFull, true);
  assert.equal(q.depositCents, q.totalCents);
  assert.throws(() => pricing.quote({ packageId: 'rookie', kids: 21, partyDate: '2026-11-05', today: '2026-11-01' }, config), /limited to 20/);
});

function service(at = '2026-11-01T14:00:00Z') {
  let now = new Date(at);
  const db = open(':memory:');
  const svc = createService(db, config, () => now);
  return { db, svc, setNow: (iso) => { now = new Date(iso); } };
}

const guest = { packageId: 'allstar', kids: 15, partyDate: '2026-11-14', time: '12:00', parentName: 'Pat Parent', email: 'pat@example.com', phone: '516-555-0100', childName: 'Sam' };

test('booking holds a slot, expires if unpaid, confirms on deposit', () => {
  const { svc, setNow } = service();
  const b = svc.create(guest);
  assert.equal(b.status, 'pending');
  assert.throws(() => svc.create({ ...guest }), /just taken/); // game room clash at same time

  setNow('2026-11-01T15:00:00Z'); // hold (30 min) passed
  svc.expireHolds();
  assert.equal(svc.get(b.id).status, 'expired');
  const b2 = svc.create(guest); // slot free again
  const paid = svc.recordPayment(b2.id, { kind: 'deposit', method: 'stripe', amountCents: b2.deposit_cents, stripeSessionId: 'cs_1' });
  assert.equal(paid.status, 'confirmed');
  // duplicate webhook is ignored
  const again = svc.recordPayment(b2.id, { kind: 'deposit', method: 'stripe', amountCents: b2.deposit_cents, stripeSessionId: 'cs_1' });
  assert.equal(again.paid_cents, b2.deposit_cents);
  const full = svc.recordPayment(b2.id, { kind: 'balance', method: 'cash', amountCents: again.balanceCents });
  assert.equal(full.status, 'paid');
  assert.equal(full.balanceCents, 0);
});

test('summary flags overdue balances and vendor orders', () => {
  const { svc, setNow } = service();
  const b = svc.create({ ...guest, addOns: { pizza: 3 } });
  svc.recordPayment(b.id, { kind: 'deposit', method: 'stripe', amountCents: b.deposit_cents, stripeSessionId: 'cs_x' });
  setNow('2026-11-09T14:00:00Z'); // after the 11-07 due date
  const s = svc.summary();
  assert.equal(s.overdue.n, 1);
  assert.equal(s.vendors[0].items['Extra pizza pie'], 3);
  assert.ok(svc.get(b.id).balanceOverdue);
});

test('leads are validated and saved', () => {
  const { svc } = service();
  assert.throws(() => svc.createLead({ eventType: 'corporate', name: 'A' }), /name and email/);
  const lead = svc.createLead({ eventType: 'corporate', name: 'Acme HR', email: 'hr@acme.com', groupSize: 40 });
  assert.equal(svc.updateLead(lead.id, { status: 'contacted' }).status, 'contacted');
});

test('stripe webhook signatures are verified', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ type: 'x' });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.deepEqual(stripe.verifyWebhook(body, `t=${t},v1=${sig}`, secret), { type: 'x' });
  assert.throws(() => stripe.verifyWebhook(body, `t=${t},v1=${'0'.repeat(64)}`, secret), /mismatch/);
  assert.equal(stripe.encode({ a: { 0: { b: 'x y' } } }), 'a%5B0%5D%5Bb%5D=x%20y');
});

test('HTTP: full demo booking flow and admin auth', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ADMIN_PASSWORD = 'secret';
  const db = open(':memory:');
  const app = createApp(db, { clock: () => new Date('2026-11-01T14:00:00Z') });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/book`);
    assert.equal(page.status, 200);

    const slots = await (await fetch(`${base}/api/availability?date=2026-11-14`)).json();
    assert.ok(slots.slots.some((s) => s.available));

    const res = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guest) });
    const created = await res.json();
    assert.equal(res.status, 200, JSON.stringify(created));
    assert.match(created.checkoutUrl, /\/pay\/demo\?/);

    const pay = await fetch(created.checkoutUrl.replace(/^http:\/\/[^/]+/, base), { method: 'POST', redirect: 'manual' });
    assert.equal(pay.status, 303);
    const loc = new URL(pay.headers.get('location'));
    const conf = await fetch(base + loc.pathname + loc.search);
    assert.equal(conf.status, 200);
    assert.match(await conf.text(), new RegExp(`const REF = "${created.ref}"`));
    const view = await (await fetch(`${base}/api/bookings/${created.ref}?t=${loc.searchParams.get('t')}`)).json();
    assert.equal(view.status, 'confirmed');
    assert.ok(view.balanceCents > 0);
    assert.ok(view.inviteToken);
    assert.match(view.referralCode, /^SAM-/);

    // wrong token can't see the booking
    assert.equal((await fetch(`${base}/api/bookings/${created.ref}?t=nope`)).status, 404);

    // admin requires the password
    assert.equal((await fetch(`${base}/api/admin/summary`)).status, 401);
    const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
    const sum = await (await fetch(`${base}/api/admin/summary`, { headers: auth })).json();
    assert.equal(sum.upcoming.n, 1);
    const csvText = await (await fetch(`${base}/api/admin/export/payments.csv`, { headers: auth })).text();
    assert.match(csvText, /deposit,demo/);

    // bad input is a friendly 400, not a crash
    const bad = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...guest, kids: 99 }) });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
