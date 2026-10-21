const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const pricing = require('../src/pricing');
const priceSettings = require('../src/price-settings');
const { open } = require('../src/db');
const { createService } = require('../src/bookings');
const { createNotifier } = require('../src/notifications');
const { createQuickBooks } = require('../src/quickbooks');

const guest = { packageId: 'allstar', kids: 15, partyDate: '2026-11-28', time: '12:00', parentName: 'Pat Parent', email: 'pat@example.com', phone: '516-555-0100', childName: 'Sam' };

function setup(at = '2026-11-01T14:00:00Z', notifierOpts = {}) {
  let now = new Date(at);
  const clock = () => now;
  const db = open(':memory:');
  priceSettings.apply(db);
  const hooks = { onPayment: [], onLead: [] };
  const svc = createService(db, config, clock, hooks);
  const sent = [];
  const notifier = createNotifier(db, svc, { clock, baseUrl: 'https://book.nxgs.net', sender: async (m) => { sent.push(m); return `id_${sent.length}`; }, ...notifierOpts });
  hooks.onPayment.push(notifier.onPayment);
  hooks.onLead.push(notifier.onLead);
  return { db, svc, notifier, sent, hooks, setNow: (iso) => { now = new Date(iso); } };
}

// ---------- add-ons from the pricing guide ----------
test('add-on minimums and lead times are enforced', () => {
  const base = { packageId: 'rookie', kids: 15, today: '2026-11-01' };
  // favor boxes: min 12, 2 weeks
  assert.throws(() => pricing.quote({ ...base, partyDate: '2026-11-28', addOns: { 'favor-box': 5 } }), /minimum order is 12/);
  assert.throws(() => pricing.quote({ ...base, partyDate: '2026-11-10', addOns: { 'favor-box': 12 } }), /needs 14 days/);
  const ok = pricing.quote({ ...base, partyDate: '2026-11-28', addOns: { 'favor-box': 15, 'cake-topper': 1 } });
  assert.equal(ok.lines.find((l) => l.id === 'favor-box').totalCents, 15 * 1200);
  // backdrop needs 4 weeks
  assert.throws(() => pricing.quote({ ...base, partyDate: '2026-11-20', addOns: { backdrop: 1 } }), /needs 28 days/);
  assert.equal(pricing.quote({ ...base, partyDate: '2026-12-05', addOns: { backdrop: 1 } }).lines.at(-1).totalCents, 29900);
  // all 20 items from the guide are present
  assert.equal(config.addOns.filter((a) => ['favors', 'decor'].includes(a.category) && a.id !== 'shirts').length, 20);
});

// ---------- admin price editing ----------
test('prices edited in admin apply to new quotes, and reset restores starting prices', () => {
  const db = open(':memory:');
  try {
    priceSettings.save(db, { packages: { rookie: { priceCents: 49900 } }, addOns: { medal: { active: false } }, party: { depositPercent: 30, taxRatePercent: 8 } });
    const q = pricing.quote({ packageId: 'rookie', kids: 15, partyDate: '2026-12-12', today: '2026-11-01' });
    assert.equal(q.subtotalCents, 49900);
    assert.equal(q.taxCents, Math.round(49900 * 0.08));
    assert.equal(q.depositCents, Math.round(q.totalCents * 0.3));
    assert.throws(() => pricing.quote({ packageId: 'rookie', kids: 15, partyDate: '2026-12-12', today: '2026-11-01', addOns: { medal: 12 } }), /no longer offered/);
    assert.throws(() => priceSettings.save(db, { addOns: { medal: { priceCents: -5 } } }), /zero or more/);
    assert.equal(priceSettings.view().packages[0].startingPriceCents, 45000);
  } finally {
    priceSettings.reset(db);
  }
  assert.equal(config.packages[0].priceCents, 45000);
  assert.equal(config.payments.depositPercent, 25);
  assert.equal(config.tax.rate, 0.08625);
});

// ---------- emails ----------
test('deposit sends a confirmation to the customer and an alert to staff', async () => {
  const { svc, notifier, sent } = setup();
  const b = svc.create(guest);
  svc.recordPayment(b.id, { kind: 'deposit', method: 'stripe', amountCents: b.deposit_cents, stripeSessionId: 'cs_1' });
  await notifier.flush();
  const toCustomer = sent.filter((m) => m.to === 'pat@example.com');
  assert.equal(toCustomer.length, 1);
  assert.match(toCustomer[0].subject, /Party confirmed/);
  assert.match(toCustomer[0].html, /https:\/\/book\.nxgs\.net\/booking\/NX-/);
  assert.ok(sent.some((m) => config.emails.staffAlerts.includes(m.to) && /New party/.test(m.subject)));

  // balance payment → receipt
  svc.recordPayment(b.id, { kind: 'balance', method: 'cash', amountCents: svc.get(b.id).balanceCents });
  await notifier.flush();
  assert.match(sent.at(-1).subject, /Payment received/);
});

test('balance reminder, overdue notice and party-tomorrow go once each, inside sending hours', async () => {
  const { svc, notifier, sent, setNow } = setup();
  const b = svc.create(guest); // party 11-28, balance due 11-21, reminder from 11-18
  svc.recordPayment(b.id, { kind: 'deposit', method: 'stripe', amountCents: b.deposit_cents, stripeSessionId: 'cs_2' });
  await notifier.flush();
  const before = sent.length;

  setNow('2026-11-17T15:00:00Z'); // 10 AM ET, too early for reminder
  await notifier.tick();
  assert.equal(sent.length, before);

  setNow('2026-11-18T05:00:00Z'); // 1 AM ET — right day, quiet hours
  await notifier.tick();
  assert.equal(sent.length, before);

  setNow('2026-11-18T15:00:00Z'); // 10 AM ET
  await notifier.tick();
  await notifier.tick(); // running twice must not double-send
  assert.equal(sent.filter((m) => /Balance due/.test(m.subject)).length, 1);

  setNow('2026-11-22T15:00:00Z'); // day after due date
  await notifier.tick();
  assert.equal(sent.filter((m) => /past due/.test(m.subject)).length, 1);
  assert.ok(sent.some((m) => /Overdue balance/.test(m.subject)));

  setNow('2026-11-27T20:00:00Z'); // day before the party
  await notifier.tick();
  assert.equal(sent.filter((m) => /See you tomorrow/.test(m.subject)).length, 1);
});

test('without an email key, emails are recorded but not sent', async () => {
  const { svc, notifier } = setup(undefined, { sender: null });
  svc.createLead({ eventType: 'corporate', name: 'Acme HR', email: 'hr@acme.com' });
  await notifier.flush();
  const list = notifier.list();
  assert.ok(list.length >= 2);
  assert.ok(list.every((e) => e.status === 'not_configured'));
  assert.equal(notifier.enabled, false);
});

test('a failed send is retried', async () => {
  let fail = true;
  const { svc, notifier, db } = setup(undefined, { sender: async () => { if (fail) throw new Error('boom'); return 'ok'; } });
  svc.createLead({ eventType: 'team', name: 'Coach', email: 'coach@example.com' });
  await notifier.flush();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM emails WHERE status = 'failed'`).get().n > 0, true);
  fail = false;
  await notifier.flush();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM emails WHERE status != 'sent'`).get().n, 0);
});

// ---------- QuickBooks ----------
function fakeQuickBooks() {
  const calls = [];
  const store = { Customer: [], Item: [], SalesReceipt: [], Account: [{ Id: '79', Name: 'Sales', AccountType: 'Income' }] };
  let tokenCount = 0;
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/oauth2/v1/tokens/bearer')) {
      tokenCount++;
      return json({ access_token: `at${tokenCount}`, refresh_token: `rt${tokenCount}`, expires_in: 3600, x_refresh_token_expires_in: 8640000 });
    }
    const u = new URL(url);
    if (u.pathname.endsWith('/query')) {
      const sql = u.searchParams.get('query');
      const entity = /from (\w+)/.exec(sql)[1];
      const m = /(\w+) = '((?:[^'\\]|\\.)*)'/.exec(sql);
      const rows = store[entity].filter((r) => !m || String(r[m[1]] ?? (m[1] === 'AccountType' ? r.AccountType : '')) === m[2].replace(/\\'/g, "'"));
      return json({ QueryResponse: rows.length ? { [entity]: rows } : {} });
    }
    if (u.pathname.includes('/companyinfo/')) return json({ CompanyInfo: { CompanyName: 'Next Generation Sports Complex LLC' } });
    const entity = { customer: 'Customer', item: 'Item', salesreceipt: 'SalesReceipt' }[u.pathname.split('/').pop()];
    const body = JSON.parse(init.body);
    const row = { Id: String(store[entity].length + 100), ...body };
    store[entity].push(row);
    return json({ [entity]: row });
  };
  return { fetchImpl, calls, store };
}

test('QuickBooks: connect, then each real payment becomes a sales receipt (once)', async () => {
  process.env.QBO_CLIENT_ID = 'cid';
  process.env.QBO_CLIENT_SECRET = 'secret';
  process.env.BASE_URL = 'https://book.nxgs.net';
  let now = new Date('2026-11-01T14:00:00Z');
  const { fetchImpl, store, calls } = fakeQuickBooks();
  const db = open(':memory:');
  const hooks = { onPayment: [], onLead: [] };
  const svc = createService(db, config, () => now, hooks);
  const qbo = createQuickBooks(db, { fetch: fetchImpl, clock: () => now });
  hooks.onPayment.push(qbo.onPayment);
  try {
    const url = new URL(qbo.authorizeUrl());
    assert.equal(url.searchParams.get('redirect_uri'), 'https://book.nxgs.net/quickbooks/callback');
    await assert.rejects(qbo.handleCallback({ code: 'c', state: 'wrong', realmId: '123' }), /expired/);
    const state = new URL(qbo.authorizeUrl()).searchParams.get('state');
    const st = await qbo.handleCallback({ code: 'c', state, realmId: '123' });
    assert.equal(st.connected, true);
    assert.equal(st.company, 'Next Generation Sports Complex LLC');

    const b = svc.create(guest);
    svc.recordPayment(b.id, { kind: 'deposit', method: 'stripe', amountCents: b.deposit_cents, stripeSessionId: 'cs_q', paymentIntent: 'pi_123' });
    svc.recordPayment(b.id, { kind: 'balance', method: 'demo', amountCents: 100, stripeSessionId: 'demo_1' }); // demo: skipped
    const r = await qbo.syncPending();
    assert.deepEqual([r.synced, r.failed], [1, 0]);
    assert.equal(store.Customer.length, 1);
    assert.equal(store.Customer[0].PrimaryEmailAddr.Address, 'pat@example.com');
    assert.equal(store.Item[0].Name, 'Party Booking');
    const receipt = store.SalesReceipt[0];
    assert.equal(receipt.Line[0].Amount, b.deposit_cents / 100);
    assert.match(receipt.Line[0].Description, /Deposit — All-Star Party/);
    assert.equal(receipt.PaymentRefNum, 'pi_123');

    // second payment reuses customer & item
    svc.recordPayment(b.id, { kind: 'balance', method: 'card_in_person', amountCents: 5000 });
    await qbo.syncPending();
    assert.equal(store.Customer.length, 1);
    assert.equal(store.Item.length, 1);
    assert.equal(store.SalesReceipt.length, 2);
    // nothing left to send; running again sends nothing
    assert.deepEqual(await qbo.syncPending(), { synced: 0, failed: 0 });

    // access token refreshes after an hour and the new refresh token is kept
    now = new Date('2026-11-01T16:00:00Z');
    svc.recordPayment(b.id, { kind: 'balance', method: 'cash', amountCents: 1000 });
    await qbo.syncPending();
    const refreshes = calls.filter((c) => c.url.includes('tokens/bearer') && String(c.init.body).includes('refresh_token'));
    assert.equal(refreshes.length, 1);
    assert.match(String(refreshes[0].init.body), /refresh_token=rt1/);
    assert.equal(qbo.status().synced, 3);
  } finally {
    delete process.env.QBO_CLIENT_ID; delete process.env.QBO_CLIENT_SECRET; delete process.env.BASE_URL;
  }
});

test('QuickBooks: payments wait safely until connected', async () => {
  const db = open(':memory:');
  const hooks = { onPayment: [], onLead: [] };
  const svc = createService(db, config, () => new Date('2026-11-01T14:00:00Z'), hooks);
  const qbo = createQuickBooks(db, { fetch: async () => { throw new Error('should not call'); } });
  hooks.onPayment.push(qbo.onPayment);
  const b = svc.create(guest);
  svc.recordPayment(b.id, { kind: 'deposit', method: 'cash', amountCents: b.deposit_cents });
  assert.equal((await qbo.syncPending()).skipped, true);
  assert.equal(qbo.status().pending, 1);
});

// ---------- calendar ----------
test('public calendar shows open / few / full / closed days without revealing who booked', () => {
  const { svc } = setup('2026-11-01T14:00:00Z');
  const cal = svc.calendarMonth('2026-11');
  const day = (d) => cal.days.find((x) => x.date === d);
  assert.equal(day('2026-11-02').status, 'closed');      // Monday
  assert.equal(day('2026-11-01').status, 'call');        // today: inside the 2-day minimum
  assert.equal(day('2026-11-14').status, 'open');        // Saturday
  const totalSat = day('2026-11-14').available;

  // Fill Saturday the 21st completely
  let booked = 0;
  for (const t of svc.availability('2026-11-21').slots.map((s) => s.time)) {
    try { svc.create({ ...guest, partyDate: '2026-11-21', time: t }); booked++; } catch {}
  }
  assert.ok(booked >= 4);
  assert.equal(svc.calendarMonth('2026-11').days.find((x) => x.date === '2026-11-21').status, 'full');

  // Public availability carries no reasons/names
  const slots = svc.availability('2026-11-21').slots;
  assert.ok(slots.every((s) => !('reason' in s)));
  assert.ok(totalSat > 4);
});

test('staff closures block booking and show on calendars', () => {
  const { svc } = setup('2026-11-01T14:00:00Z');
  svc.create({ ...guest, partyDate: '2026-11-14', time: '12:00' });
  const r = svc.addBlock({ date: '2026-11-14', start: '13:00', end: '16:00', reason: 'Tournament' });
  assert.equal(r.clashes.length, 1); // the 12:00 party overlaps — staff are warned
  const slots = svc.availability('2026-11-14').slots;
  assert.equal(slots.find((s) => s.time === '14:00').available, false);
  assert.equal(slots.find((s) => s.time === '16:00').available, true);
  assert.throws(() => svc.create({ ...guest, partyDate: '2026-11-14', time: '14:30' }), /just taken/);

  const allDay = svc.addBlock({ date: '2026-11-15', reason: 'Closed for holiday' });
  assert.equal(svc.calendarMonth('2026-11').days.find((x) => x.date === '2026-11-15').status, 'closed');
  assert.throws(() => svc.create({ ...guest, partyDate: '2026-11-15', time: '12:00' }), /closed that day/);
  svc.removeBlock(allDay.id);
  assert.equal(svc.calendarMonth('2026-11').days.find((x) => x.date === '2026-11-15').status, 'open');

  const m = svc.adminMonth('2026-11');
  assert.equal(m.parties.length, 1);
  assert.equal(m.blocks[0].label, '1:00 PM – 4:00 PM');
});

test('HTTP: calendar page, calendar API and private Google Calendar feed', async () => {
  const http = require('node:http');
  const { createApp } = require('../src/server');
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ADMIN_PASSWORD = 'secret';
  const db = open(':memory:');
  const app = createApp(db, { clock: () => new Date('2026-11-01T14:00:00Z'), background: false });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/calendar`)).status, 200);
    const cal = await (await fetch(`${base}/api/calendar?month=2026-11`)).json();
    assert.equal(cal.days.length, 30);

    const b = app.svc.create({ ...guest, childName: 'Sam, Jr.' });
    app.svc.recordPayment(b.id, { kind: 'deposit', method: 'cash', amountCents: b.deposit_cents });
    app.svc.addBlock({ date: '2026-11-29', reason: 'Thanksgiving weekend' });

    assert.equal((await fetch(`${base}/feeds/wrongtoken/parties.ics`)).status, 404);
    const ics = await (await fetch(`${base}/feeds/${app.feedToken()}/parties.ics`)).text();
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /DTSTART;TZID=America\/New_York:20261128T120000/);
    assert.match(ics, /SUMMARY:\[Farmingdale\] Sam\\, Jr\.'s party · 15 kids/);
    assert.match(ics, /LOCATION:NXGS Farmingdale\\, 388 Broad Hollow Rd/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261129/);
    assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));

    const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
    const del = await fetch(`${base}/api/admin/blocks/1`, { method: 'DELETE', headers: auth });
    assert.equal(del.status, 200);
  } finally {
    server.close();
  }
});

test('HTTP: product photos upload, show on the booking page, and can be removed', async () => {
  const http = require('node:http');
  const { createApp } = require('../src/server');
  process.env.ADMIN_PASSWORD = 'secret';
  const db = open(':memory:');
  const app = createApp(db, { clock: () => new Date('2026-11-01T14:00:00Z'), background: false });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64'), 'Content-Type': 'application/json' };
  try {
    let cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.addOns.find((a) => a.id === 'medal').photo, '/static/img/addons/medal.svg');
    assert.equal((await fetch(`${base}/static/img/addons/medal.svg`)).headers.get('content-type'), 'image/svg+xml');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const bad = await fetch(`${base}/api/admin/addons/medal/photo`, { method: 'POST', headers: auth, body: JSON.stringify({ dataUrl: 'data:text/html;base64,PGI+' }) });
    assert.equal(bad.status, 400);
    const up = await fetch(`${base}/api/admin/addons/medal/photo`, { method: 'POST', headers: auth, body: JSON.stringify({ dataUrl: 'data:image/png;base64,' + png.toString('base64') }) });
    assert.equal(up.status, 200);
    cfg = await (await fetch(`${base}/api/config`)).json();
    const photo = cfg.addOns.find((a) => a.id === 'medal').photo;
    assert.match(photo, /^\/media\/[a-f0-9]+\.png$/);
    const img = await fetch(base + photo);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);

    // Resetting prices keeps photos; removing the photo brings back the illustration.
    await fetch(`${base}/api/admin/pricing/reset`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal((await (await fetch(`${base}/api/config`)).json()).addOns.find((a) => a.id === 'medal').photo, photo);
    await fetch(`${base}/api/admin/addons/medal/photo`, { method: 'DELETE', headers: auth });
    assert.equal((await (await fetch(`${base}/api/config`)).json()).addOns.find((a) => a.id === 'medal').photo, '/static/img/addons/medal.svg');
    assert.equal((await fetch(base + photo)).status, 404);
    assert.equal((await fetch(`${base}/api/admin/addons/medal/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  } finally {
    server.close();
  }
});

test('new add-ons: bagels, coffee, scoreboard and bounce house (one per party)', () => {
  const base = { packageId: 'rookie', kids: 15, today: '2026-11-01', partyDate: '2026-11-28' };
  const q = pricing.quote({ ...base, addOns: { bagels: 2, coffee: 1, scoreboard: 1, 'bounce-house': 1 } });
  assert.equal(q.lines.filter((l) => l.kind === 'addon').length, 4);
  assert.throws(() => pricing.quote({ ...base, addOns: { 'bounce-house': 2 } }), /limit 1 per party/);
  assert.throws(() => pricing.quote({ ...base, partyDate: '2026-11-06', addOns: { 'bounce-house': 1 } }), /needs 7 days/);
  assert.ok(config.addOns.every((a) => a.includes), 'every add-on says what is included');
  assert.ok(config.packages.every((p) => p.includes));
});

test('Rookie Party is 90 minutes; its game room slot and end time follow its own schedule', () => {
  const scheduling = require('../src/scheduling');
  const q = pricing.quote({ packageId: 'rookie', kids: 15, partyDate: '2026-11-28', today: '2026-11-01' });
  assert.equal(q.minutes, 90);
  assert.deepEqual(q.phases.map((p) => [p.label, p.minutes]), [['Field play (1 sport)', 30], ['Video game room', 30], ['Food, cake & presents', 30]]);
  assert.equal(pricing.quote({ packageId: 'allstar', kids: 15, partyDate: '2026-11-28', today: '2026-11-01' }).minutes, 120);
  assert.equal(pricing.quote({ packageId: 'allstar', kids: 15, partyDate: '2026-11-28', today: '2026-11-01' }).phases[0].label, 'Field play (2 sports)');
  assert.equal(pricing.quote({ packageId: 'mvp', kids: 15, partyDate: '2026-11-28', today: '2026-11-01' }).phases[0].label, 'Field play (3 sports)');
  assert.equal(config.packages.find((p) => p.id === 'mvp').shirtsForAll, true);

  const { svc } = setup('2026-11-01T14:00:00Z');
  const b = svc.create({ ...guest, packageId: 'rookie', partyDate: '2026-11-28', time: '12:00' });
  assert.equal(b.endLabel, '1:30 PM');
  assert.deepEqual(b.schedule.map((s) => s.from), ['12:00 PM', '12:30 PM', '1:00 PM']);
  // Rookie at noon uses the game room 12:30–1:00, so an All-Star at noon (game room 1:00–1:30) fits alongside it
  const day = svc.availability('2026-11-28', null, 'allstar');
  assert.equal(day.slots.find((s) => s.time === '12:00').available, true);
  // a Rookie slot ends 90 minutes later, so later start times are offered than for 2-hour parties
  assert.equal(svc.availability('2026-11-28', null, 'rookie').slots.at(-1).time, '18:30');
  assert.equal(svc.availability('2026-11-28', null, 'allstar').slots.at(-1).time, '18:00');
  assert.equal(scheduling.partyMinutes(config), 120, 'standard schedule unchanged');
});
