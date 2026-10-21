// Locations, sponsors and the vendor marketplace.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const party = { packageId: 'rookie', kids: 15, partyDate: '2026-11-28', time: '12:00', parentName: 'Dana Rivera', email: 'dana@example.com', phone: '516-555-0101', childName: 'Liam' };

async function start(at = '2026-11-01T15:00:00Z') {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ADMIN_PASSWORD = 'secret';
  let now = new Date(at);
  const sent = [];
  const db = open(':memory:');
  const app = createApp(db, { clock: () => now, background: false, baseUrl: 'https://book.nxgs.net', emailSender: async (m) => { sent.push(m); return 'x'; } });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
  const call = async (method, path, body, admin = false) => {
    const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(admin ? auth : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
  const bookAndPay = async (input) => {
    const r = await call('POST', '/api/bookings', input);
    assert.equal(r.status, 200, r.text);
    const u = new URL(r.json.checkoutUrl);
    await call('POST', u.pathname + u.search);
    return app.svc.getByRef(r.json.ref);
  };
  return { app, db, call, bookAndPay, sent, setNow: (iso) => { now = new Date(iso); }, close: () => server.close() };
}

test('locations: Farmingdale is public, Massapequa is staff-only, calendars are separate', async () => {
  const t = await start();
  try {
    const cfg = (await t.call('GET', '/api/config')).json;
    assert.deepEqual(cfg.locations.map((l) => l.id), ['farmingdale']);
    assert.equal(cfg.locations[0].address, '388 Broad Hollow Rd, Farmingdale, NY 11735');
    assert.equal((await t.call('GET', '/api/calendar?month=2026-11&location=massapequa')).status, 400);
    assert.match((await t.call('POST', '/api/bookings', { ...party, locationId: 'massapequa' })).json.error, /not taking bookings yet/);

    const all = (await t.call('GET', '/api/admin/locations', null, true)).json;
    assert.deepEqual(all.map((l) => [l.id, l.public]), [['farmingdale', true], ['massapequa', false]]);
    assert.equal(all[1].address, '400 Carman Mill Rd, Massapequa, NY 11758');

    // Staff can set up Massapequa: a closure there doesn't touch Farmingdale
    await t.call('POST', '/api/admin/blocks', { locationId: 'massapequa', date: '2026-11-28', reason: 'Grand opening prep' }, true);
    assert.equal(t.app.svc.calendarMonth('2026-11', 'massapequa').days.find((d) => d.date === '2026-11-28').status, 'closed');
    assert.equal(t.app.svc.calendarMonth('2026-11', 'farmingdale').days.find((d) => d.date === '2026-11-28').status, 'open');

    // Each location has its own capacity: two parties at noon in Farmingdale doesn't fill Massapequa
    const b = await t.bookAndPay(party);
    assert.equal(b.location_id, 'farmingdale');
    assert.equal(b.location.name, 'NXGS Farmingdale');
    t.app.svc.create({ ...party, partyDate: '2026-11-29', locationId: 'massapequa', email: 'm@example.com' }); // staff-side booking
    assert.equal(t.app.svc.list({ locationId: 'massapequa' }).length, 1);
    assert.equal((await t.call('GET', '/api/admin/summary?location=farmingdale', null, true)).json.upcoming.n, 1);
    assert.equal((await t.call('GET', '/api/admin/bookings?location=massapequa', null, true)).json.length, 1);
    const sheet = (await t.call('GET', '/api/admin/runsheet?date=2026-11-28&location=massapequa', null, true)).json;
    assert.equal(sheet.location.id, 'massapequa');
    assert.equal(sheet.parties.length, 0);
    assert.deepEqual(sheet.closures, ['Grand opening prep']);

    const inv = (await t.call('GET', `/api/invite/${b.invite_token}`)).json;
    assert.equal(inv.place.address, '388 Broad Hollow Rd, Farmingdale, NY 11735');
    assert.match(t.app.assistant.instructions(), /NXGS Massapequa is coming soon/);
  } finally { t.close(); }
});

test('sponsors: logos show only where and when they were bought; views and clicks are counted', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('POST', '/api/admin/sponsors', { name: '' }, true)).status, 400);
    const nike = (await t.call('POST', '/api/admin/sponsors', { name: 'Nike', website: 'nike.com', packageId: 'presenting', placements: ['booking', 'invite', 'email'], contractDollars: 6000, startsOn: '2026-11-01', endsOn: '2026-12-31' }, true)).json;
    assert.equal(nike.website, 'https://nike.com');
    await t.call('POST', `/api/admin/sponsors/${nike.id}/logo`, { dataUrl: PNG }, true);
    await t.call('POST', '/api/admin/sponsors', { name: 'Massapequa Bagels', placements: ['booking'], locationId: 'massapequa' }, true);
    await t.call('POST', '/api/admin/sponsors', { name: 'Future Co', placements: ['booking'], startsOn: '2027-01-01' }, true);

    let shown = (await t.call('GET', '/api/sponsors?placement=booking&location=farmingdale')).json.sponsors;
    assert.deepEqual(shown.map((s) => s.name), ['Nike']);
    assert.match(shown[0].logo, /^\/media\//);
    assert.equal((await t.call('GET', '/api/sponsors?placement=calendar&location=farmingdale')).json.sponsors.length, 0);

    const click = await t.call('GET', `/s/${nike.id}`);
    assert.equal(click.status, 303);
    assert.equal(click.headers.get('location'), 'https://nike.com');

    // emails carry the sponsor line
    await t.bookAndPay(party);
    await t.app.notifier.flush();
    assert.ok(t.sent.some((m) => /Parties presented by .*Nike/.test(m.html)));

    const s = (await t.call('GET', '/api/admin/sponsors', null, true)).json;
    const n = s.sponsors.find((x) => x.name === 'Nike');
    assert.ok(n.impressions >= 2);
    assert.equal(n.clicks, 1);
    assert.equal(s.totals.activeContractCents, 600000);

    // paused sponsors disappear; ended dates too
    await t.call('PATCH', `/api/admin/sponsors/${nike.id}`, { status: 'paused' }, true);
    assert.equal((await t.call('GET', '/api/sponsors?placement=booking')).json.sponsors.length, 0);

    // sponsor inquiry from the Partners page lands in Leads
    await t.call('POST', '/api/partners/sponsor', { name: 'Pat Brand', organization: 'Gatorade', email: 'pat@gatorade.example', packageId: 'invitations', message: 'Q1 budget' });
    const lead = t.app.svc.listLeads().find((l) => l.event_type === 'sponsor');
    assert.match(lead.message, /Invitation sponsor/);
    assert.ok(!(await t.call('GET', '/api/config')).json.inquiryTypes.some((x) => x.id === 'sponsor'), 'not offered on the party inquiry form');
  } finally { t.close(); }
});

test('marketplace: vendor applies, NXGS approves with markup, product sells, vendor gets the order', async () => {
  const t = await start();
  try {
    assert.match((await t.call('POST', '/api/partners/vendor', { businessName: 'Sweet Treats LI', contactName: 'Kim', email: 'kim@sweet.example', audiences: ['birthday'], products: [] })).json.error, /at least one product/);
    const app = await t.call('POST', '/api/partners/vendor', {
      businessName: 'Sweet Treats LI', contactName: 'Kim Lee', email: 'kim@sweet.example', phone: '516-555-0150', category: 'Food & treats', audiences: ['birthday', 'corporate'], insured: true,
      products: [{ name: 'Custom cookie favors', description: '2 decorated cookies, bagged', price: '4.00', unit: 'each', minQty: 12, leadDays: 10 }, { name: 'Cake pops', price: '30', unit: 'dozen' }],
    });
    assert.equal(app.status, 200, app.text);
    await t.app.notifier.flush();
    assert.ok(t.sent.some((m) => m.to === 'kim@sweet.example' && /got your application/.test(m.subject)));
    assert.ok(t.sent.some((m) => /New vendor application: Sweet Treats LI/.test(m.subject)));

    // nothing shows until approved AND the product is live
    let cfg = (await t.call('GET', '/api/config')).json;
    assert.ok(!cfg.addOns.some((a) => a.category === 'partners'));
    const v = (await t.call('GET', `/api/admin/vendors/${app.json.id}`, null, true)).json;
    assert.equal(v.products.length, 2);
    assert.equal(v.products[0].priceApplied, 540, '35% default markup on $4.00');
    await t.call('PATCH', `/api/admin/vendors/${v.id}`, { status: 'approved', markupPercent: 50 }, true);
    const cookies = v.products[0];
    await t.call('PATCH', `/api/admin/vendors/${v.id}/products/${cookies.id}`, { active: true, includes: '2 cookies\nRibbon and name tag' }, true);
    await t.call('PATCH', `/api/admin/vendors/${v.id}/products/${v.products[1].id}`, { active: true, price: '49.99' }, true); // hand-set price
    cfg = (await t.call('GET', '/api/config')).json;
    const partnerItems = cfg.addOns.filter((a) => a.category === 'partners');
    assert.equal(partnerItems.length, 2);
    const cookieItem = partnerItems.find((a) => a.name === 'Custom cookie favors');
    assert.equal(cookieItem.priceCents, 600, '$4.00 + 50% vendor markup');
    assert.equal(cookieItem.minQty, 12);
    assert.ok(!('costCents' in cookieItem) && !('vendor' in cookieItem), 'customers never see cost or vendor field');
    assert.equal(partnerItems.find((a) => a.name === 'Cake pops').priceCents, 4999);

    // pricing tab edits and resets keep partner products in the catalog
    await t.call('PUT', '/api/admin/pricing', { packages: { rookie: { priceCents: 46000 } } }, true);
    assert.equal((await t.call('GET', '/api/config')).json.addOns.filter((a) => a.category === 'partners').length, 2);
    assert.ok(!(await t.call('GET', '/api/admin/pricing', null, true)).json.addOns.some((a) => a.marketplace), 'managed in Marketplace, not Pricing');

    // a family books cookies; minimums and lead times apply like any add-on
    assert.match((await t.call('POST', '/api/quote', { ...party, addOns: { [cookieItem.id]: 5 } })).json.error, /minimum order is 12/);
    const b = await t.bookAndPay({ ...party, addOns: { [cookieItem.id]: 15 } });
    const orders = (await t.call('GET', '/api/admin/marketplace', null, true)).json;
    assert.equal(orders.orders.length, 1);
    assert.equal(orders.orders[0].qty, 15);
    assert.equal(orders.totals.owedCents, 15 * 400);
    assert.equal(orders.totals.marginCents, 15 * 200);
    await t.app.notifier.flush();
    const vendorMail = t.sent.find((m) => m.to === 'kim@sweet.example' && /New NXGS order/.test(m.subject));
    assert.ok(vendorMail);
    assert.match(vendorMail.html, /388 Broad Hollow Rd/);
    assert.match(vendorMail.html, /\$60\.00/, 'shows what NXGS pays, not the customer price');
    assert.ok(!vendorMail.html.includes('dana@example.com'), "vendor doesn't get the family's contact details");

    // second payment doesn't duplicate the order; payout is tracked
    t.app.svc.recordPayment(b.id, { kind: 'balance', method: 'cash', amountCents: 1000 });
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM vendor_orders').get().n, 1);
    await t.call('PATCH', `/api/admin/vendor-orders/${orders.orders[0].id}`, { status: 'paid_out' }, true);
    assert.equal((await t.call('GET', '/api/admin/marketplace', null, true)).json.totals.owedCents, 0);

    // corporate catalog shows corporate/both products; pausing a vendor removes their products
    assert.equal((await t.call('GET', '/api/partners/corporate')).json.length, 2);
    await t.call('PATCH', `/api/admin/vendors/${v.id}`, { status: 'paused' }, true);
    assert.equal((await t.call('GET', '/api/config')).json.addOns.filter((a) => a.category === 'partners').length, 0);
    assert.equal((await t.call('GET', '/api/partners/corporate')).json.length, 0);
  } finally { t.close(); }
});

test('marketplace: cancelling a party cancels unpaid vendor orders', async () => {
  const t = await start();
  try {
    const app = await t.call('POST', '/api/partners/vendor', { businessName: 'Balloon Bros', contactName: 'Al', email: 'al@b.example', audiences: ['birthday'], products: [{ name: 'Arch', price: '100', leadDays: 3 }] });
    const v = (await t.call('GET', `/api/admin/vendors/${app.json.id}`, null, true)).json;
    await t.call('PATCH', `/api/admin/vendors/${v.id}`, { status: 'approved' }, true);
    await t.call('PATCH', `/api/admin/vendors/${v.id}/products/${v.products[0].id}`, { active: true }, true);
    const b = await t.bookAndPay({ ...party, addOns: { [`mp-${v.products[0].id}`]: 1 } });
    t.app.svc.cancel(b.id, 'family moved');
    assert.equal(t.db.prepare('SELECT status FROM vendor_orders').get().status, 'cancelled');
  } finally { t.close(); }
});
