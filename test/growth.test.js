// Home page, Spanish, peak pricing, upgrades, waitlist, abandoned-booking emails, guest offers & unsubscribe,
// self-serve reschedule/cancel, highlight video, door check-in, website content & search page, insights, setup.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../src/db');
const { createApp } = require('../src/server');

const party = { packageId: 'allstar', kids: 15, partyDate: '2026-11-28', time: '16:00', parentName: 'Dana Rivera', email: 'dana@example.com', phone: '(516) 555-0101', childName: 'Liam', childAge: 7 };

async function start(at = '2026-11-01T15:00:00Z') {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ADMIN_PASSWORD = 'secret';
  let now = new Date(at);
  const sentEmails = [];
  const db = open(':memory:');
  const app = createApp(db, { clock: () => now, background: false, baseUrl: 'https://book.nxgs.net', emailSender: async (m) => { sentEmails.push(m); return 'e' + sentEmails.length; } });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
  const call = async (method, path, body, admin = false) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(admin ? auth : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
  const bookAndPay = async (input) => {
    const r = await call('POST', '/api/bookings', input);
    assert.equal(r.status, 200, r.text);
    const u = new URL(r.json.checkoutUrl);
    const p = await call('POST', u.pathname + u.search);
    assert.equal(p.status, 303);
    return { ref: r.json.ref, t: new URL(p.headers.get('location')).searchParams.get('t') };
  };
  const emails = async () => { app.notifier.queueReminders(); await app.notifier.flush(); return sentEmails; };
  return { app, db, call, bookAndPay, emails, sentEmails, setNow: (iso) => { now = new Date(iso); }, close: () => server.close() };
}

test('home page at /, booking at /book; Spanish config, quotes and emails', async () => {
  const t = await start();
  try {
    assert.match((await t.call('GET', '/')).text, /data-word="parties"/);
    assert.match((await t.call('GET', '/book')).text, /id="partyForm"/);
    const es = (await t.call('GET', '/api/config?lang=es')).json;
    assert.equal(es.packages[0].name, 'Fiesta Rookie');
    assert.equal(es.addOns.find((a) => a.id === 'pizza').name, 'Pizza adicional');
    const q = (await t.call('POST', '/api/quote', { ...party, lang: 'es' })).json;
    assert.equal(q.lines[0].name, 'Fiesta All-Star');
    await t.bookAndPay({ ...party, lang: 'es' });
    const mail = (await t.emails()).find((m) => m.to === 'dana@example.com');
    assert.match(mail.subject, /^Fiesta confirmada/);
    assert.match(mail.html, /lang="es"/);
  } finally { t.close(); }
});

test('peak and off-peak start times change the price; upgrade and source are recorded', async () => {
  const t = await start();
  try {
    const day = (await t.call('GET', '/api/availability?date=2026-11-28&package=allstar')).json;
    assert.equal(day.slots.find((s) => s.time === '12:00').priceCents, 5000);
    assert.equal(day.slots.find((s) => s.time === '16:00').priceCents, undefined);
    const prime = (await t.call('POST', '/api/quote', { ...party, time: '12:00' })).json;
    assert.ok(prime.lines.some((l) => l.kind === 'timing' && l.totalCents === 5000));
    const friday = (await t.call('POST', '/api/quote', { ...party, partyDate: '2026-11-27', time: '17:00' })).json;
    assert.ok(friday.lines.some((l) => l.kind === 'timing' && l.totalCents === -5000));
    const { ref } = await t.bookAndPay({ ...party, upgradedFrom: 'rookie', source: 'Instagram' });
    const b = t.app.svc.getByRef(ref);
    assert.equal(b.upgraded_from, 'rookie');
    assert.equal(b.source, 'instagram');
    // Staff can change the peak price.
    await t.call('PUT', '/api/admin/pricing', { timePricing: { prime: { adjustCents: 7500 } } }, true);
    assert.equal((await t.call('GET', '/api/availability?date=2026-11-28&package=allstar')).json.slots.find((s) => s.time === '12:00').priceCents, 7500);
  } finally { t.close(); }
});

test('waitlist: a family is emailed when a time opens on their day', async () => {
  const t = await start();
  try {
    const { ref } = await t.bookAndPay(party);
    assert.equal((await t.call('POST', '/api/waitlist', { date: '2026-11-28', parentName: 'Gina Lopez', email: 'gina@example.com', packageId: 'allstar' })).status, 200);
    assert.equal((await t.call('POST', '/api/waitlist', { date: '2026-11-28', parentName: 'Gina Lopez', email: 'gina@example.com' })).json.already, true);
    const b = t.app.svc.getByRef(ref);
    await t.call('POST', `/api/admin/bookings/${b.id}/cancel`, { reason: 'test' }, true);
    const mail = (await t.emails()).find((m) => m.to === 'gina@example.com');
    assert.ok(mail, 'waitlist email sent');
    assert.match(mail.html, /src=waitlist/);
    assert.equal(t.app.waitlist.stats().notified, 1);
  } finally { t.close(); }
});

test('abandoned booking: a "still open" email a few hours after an unpaid hold runs out', async () => {
  const t = await start();
  try {
    const r = await t.call('POST', '/api/bookings', { ...party, email: 'sam@example.com', addOns: { pizza: 2 } });
    assert.equal(r.status, 200);
    t.setNow('2026-11-01T16:00:00Z'); // hold expired 30 min in; only 1 hour later now
    await t.call('GET', '/api/config');
    assert.ok(!(await t.emails()).some((m) => m.to === 'sam@example.com'));
    t.setNow('2026-11-01T19:00:00Z');
    const mail = (await t.emails()).find((m) => m.to === 'sam@example.com');
    assert.match(mail.subject, /still open/);
    assert.match(mail.html, /src=recovery/);
    assert.match(mail.html, /addons=pizza%3A2/);
    // Only once.
    await t.emails();
    assert.equal(t.sentEmails.filter((m) => m.to === 'sam@example.com').length, 1);
  } finally { t.close(); }
});

test('guest families who opt in get an offer after the party, and can unsubscribe', async () => {
  const t = await start();
  try {
    await t.bookAndPay(party);
    const b = t.app.svc.list()[0];
    await t.call('POST', `/api/invite/${b.invite_token}/rsvp`, { childName: 'Ava', parentName: 'Tara Murphy', email: 'tara@example.com', attending: 'yes', marketingOptIn: true });
    await t.call('POST', `/api/invite/${b.invite_token}/rsvp`, { childName: 'Noah', parentName: 'Chris Patel', email: 'chris@example.com', attending: 'yes' });
    t.setNow('2026-11-30T15:00:00Z');
    const sent = await t.emails();
    const offer = sent.find((m) => m.to === 'tara@example.com');
    assert.ok(offer, 'opted-in guest gets the offer');
    assert.ok(!sent.some((m) => m.to === 'chris@example.com'), 'no offer without consent');
    assert.match(offer.html, new RegExp(t.app.svc.get(b.id).referral_code));
    const link = /href="([^"]*\/unsubscribe[^"]*)"/.exec(offer.html)[1].replace(/&amp;/g, '&');
    const path = new URL(link).pathname + new URL(link).search;
    assert.match((await t.call('GET', path)).text, /Unsubscribe\?/);
    assert.match((await t.call('POST', path)).text, /unsubscribed/);
    assert.equal(t.app.audience.isSubscribed('tara@example.com'), false);
    assert.match((await t.call('GET', '/unsubscribe?e=tara@example.com&k=bad')).text, /not valid/);
  } finally { t.close(); }
});

test('families move their party once, and cancel with the refund policy', async () => {
  const t = await start();
  try {
    const { ref, t: tok } = await t.bookAndPay(party);
    const times = (await t.call('GET', `/api/bookings/${ref}/times?t=${tok}&date=2026-12-05`)).json;
    assert.ok(times.slots.some((s) => s.available));
    const moved = await t.call('POST', `/api/bookings/${ref}/reschedule?t=${tok}`, { date: '2026-12-05', time: '16:00' });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.json.partyDate, '2026-12-05');
    assert.equal(moved.json.changes.reschedule.ok, false, 'only one free move');
    assert.equal((await t.call('POST', `/api/bookings/${ref}/reschedule?t=${tok}`, { date: '2026-12-06', time: '12:00' })).status, 400);
    const sent = await t.emails();
    assert.ok(sent.some((m) => m.to === 'dana@example.com' && /moved/i.test(m.subject)));
    // Pay in full, then cancel more than 14 days out: everything but the deposit comes back.
    const b = t.app.svc.getByRef(ref);
    t.app.svc.recordPayment(b.id, { kind: 'balance', method: 'cash', amountCents: b.balanceCents });
    assert.equal((await t.call('POST', `/api/bookings/${ref}/cancel?t=${tok}`, { confirm: 'nope' })).status, 400);
    const c = await t.call('POST', `/api/bookings/${ref}/cancel?t=${tok}`, { confirm: 'CANCEL', reason: 'sick' });
    assert.equal(c.json.status, 'cancelled');
    const after = t.app.svc.getByRef(ref);
    assert.equal(after.refund_due_cents, after.total_cents - after.deposit_cents);
    // Staff record the refund by hand (cash payment).
    await t.call('POST', `/api/admin/bookings/${after.id}/refunded`, { amount: after.refund_due_cents / 100 }, true);
    assert.equal(t.app.svc.getByRef(ref).refund_due_cents, 0);
    const mails = await t.emails();
    assert.ok(mails.some((m) => /cancelled/i.test(m.subject) && m.to === 'dana@example.com'));
  } finally { t.close(); }
});

test('highlight video link is emailed to the family; door check-in by tap and by pass', async () => {
  const t = await start();
  try {
    const { ref } = await t.bookAndPay(party);
    const b = t.app.svc.getByRef(ref);
    assert.equal((await t.call('PATCH', `/api/admin/bookings/${b.id}`, { videoUrl: 'not a link' }, true)).status, 400);
    await t.call('PATCH', `/api/admin/bookings/${b.id}`, { videoUrl: 'https://youtu.be/abc123' }, true);
    assert.ok((await t.emails()).some((m) => /video/i.test(m.subject) && m.html.includes('https://youtu.be/abc123')));

    const r = (await t.call('POST', `/api/invite/${b.invite_token}/rsvp`, { childName: 'Ava', parentName: 'Tara', email: 'tara@example.com', attending: 'yes' })).json;
    assert.ok(r.checkinPass);
    assert.equal((await t.call('GET', `/c/${r.checkinPass}`)).status, 401, 'staff login required');
    const scan = await t.call('GET', `/c/${r.checkinPass}`, null, true);
    assert.match(scan.text, /Ava is checked in/);
    const forged = r.checkinPass.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    assert.match((await t.call('GET', `/c/${forged}`, null, true)).text, /not valid/);
    await t.call('POST', `/api/admin/checkin/${b.id}`, { name: 'Walk-in Wes' }, true);
    const roster = (await t.call('GET', `/api/admin/checkin/${b.id}`, null, true)).json;
    assert.equal(roster.arrived, 2);
    assert.ok(roster.people.find((p) => p.name === 'Walk-in Wes').walkIn);
  } finally { t.close(); }
});

test('website content, FAQ, search page, sitemap; insights; facility setup', async () => {
  const t = await start();
  try {
    let site = (await t.call('GET', '/api/admin/site', null, true)).json;
    const drafts = site.faq.filter((f) => f.draft);
    assert.ok(drafts.length >= 1);
    assert.ok(!(await t.call('GET', '/api/site')).json.faq.some((f) => f.q === drafts[0].q), 'drafts hidden');
    const faq = site.faq.map((f) => ({ q: f.en.q, a: f.q === drafts[0].q ? 'Yes, bring your own cake.' : f.en.a, auto: f.auto || undefined }));
    await t.call('PUT', '/api/admin/site', { faq, tourVideo: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, true);
    const pub = (await t.call('GET', '/api/site')).json;
    assert.ok(pub.faq.some((f) => f.a === 'Yes, bring your own cake.'));
    assert.match(pub.faq.find((f) => f.q === 'How do payments work?').a, /25%/);
    assert.equal(pub.tourVideo.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    assert.equal((await t.call('PUT', '/api/admin/site', { tourVideo: 'https://example.com/x' }, true)).status, 400);

    const page = (await t.call('GET', '/birthday-parties')).text;
    assert.match(page, /application\/ld\+json/);
    assert.match(page, /"@type":"FAQPage"/);
    assert.match(page, /All-Star Party/);
    assert.match((await t.call('GET', '/fiestas-de-cumpleanos')).text, /Fiesta All-Star/);
    assert.match((await t.call('GET', '/sitemap.xml')).text, /birthday-parties/);
    assert.match((await t.call('GET', '/robots.txt')).text, /Disallow: \/admin/);

    await t.bookAndPay({ ...party, source: 'chat', addOns: { pizza: 2 } });
    await t.bookAndPay({ ...party, time: '12:00', email: 'b@example.com' });
    const ins = (await t.call('GET', '/api/admin/insights?from=2026-11-01&to=2026-12-31', null, true)).json;
    assert.equal(ins.totals.parties, 2);
    assert.equal(ins.addOns[0].id, 'pizza');
    assert.equal(ins.addOns[0].attachRate, 0.5);
    assert.ok(ins.sources.some((s) => s.id === 'chat'));
    assert.ok(ins.utilization.find((u) => u.day === 'Sat').rate > 0);

    const su = (await t.call('PUT', '/api/admin/setup', { business: { name: 'Sample Sports Center', shortName: 'SSC', website: 'https://example.com', email: 'hi@example.com', address: '1 Main St, Town, NY 11111' } }, true)).json;
    assert.ok(su.status.some((x) => x.key === 'waiver' && !x.ok));
    assert.equal((await t.call('GET', '/api/config')).json.business.name, 'Sample Sports Center');
    assert.equal((await t.call('PUT', '/api/admin/setup', { brand: { primaryColor: 'blue' } }, true)).status, 400);
    assert.equal((await t.call('PUT', '/api/admin/setup', { locations: [{ id: 'farmingdale', name: 'X', public: false }, { id: 'massapequa', name: 'Y', public: false }] }, true)).status, 400);
  } finally { t.close(); }
});
