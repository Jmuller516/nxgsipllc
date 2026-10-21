const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const stripe = require('./stripe');
const { money } = require('./pricing');
const { PricingError } = require('./pricing');
const { createService, BookingError } = require('./bookings');
const { createNotifier } = require('./notifications');
const { createQuickBooks } = require('./quickbooks');
const priceSettings = require('./price-settings');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function createApp(db, opts = {}) {
  priceSettings.apply(db); // admin price edits laid over config.js starting prices
  const hooks = { onPayment: [], onLead: [] };
  const svc = createService(db, config, opts.clock, hooks);
  const notifier = createNotifier(db, svc, { clock: opts.clock, sender: opts.emailSender, baseUrl: opts.baseUrl });
  const qbo = createQuickBooks(db, { clock: opts.clock, fetch: opts.qboFetch });
  hooks.onPayment.push(notifier.onPayment, qbo.onPayment);
  hooks.onLead.push(notifier.onLead);

  // Send queued emails / QuickBooks entries soon after something happens, without slowing the request.
  let kickTimer = null;
  const kick = () => {
    if (kickTimer || opts.background === false) return;
    kickTimer = setTimeout(() => { kickTimer = null; background().catch((e) => console.error(e)); }, 250);
  };
  async function background() {
    svc.expireHolds();
    await notifier.tick();
    await qbo.syncPending();
  }
  const routes = [];
  const route = (method, pattern, handler, { admin = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler, admin });
  };

  // ---------- Public API ----------
  route('GET', '/api/config', () => ({
    business: { name: config.business.name, website: config.business.website },
    brand: { logoUrl: config.brand.logoUrl },
    packages: config.packages.filter((p) => p.active !== false),
    addOns: config.addOns.filter((a) => a.active !== false).map(({ costCents, vendor, ...a }) => a), // never expose cost or vendor
    addOnCategories: config.addOnCategories,
    inquiryTypes: config.inquiryTypes,
    party: { phases: config.party.phases, maxKids: config.party.maxKids },
    payments: { depositPercent: config.payments.depositPercent, balanceDueDaysBefore: config.payments.balanceDueDaysBefore, depositRefundable: config.payments.depositRefundable, holdMinutes: config.payments.holdMinutes },
    tax: config.tax,
    minDaysAhead: config.minDaysAhead,
    maxDaysAhead: config.maxDaysAhead,
    partyDays: Object.entries(config.partyHours).filter(([, h]) => h).map(([d]) => Number(d)),
    stripe: stripe.enabled(),
  }));

  route('GET', '/api/availability', ({ query }) => svc.availability(String(query.date || '')));

  route('POST', '/api/quote', ({ body }) => svc.quoteFor(body));

  // Live availability calendar (public: open/full only, never who booked).
  route('GET', '/api/calendar', ({ query }) => svc.calendarMonth(String(query.month || '')));

  route('POST', '/api/bookings', async ({ body, baseUrl }) => {
    const b = svc.create(body);
    const url = await startCheckout(b, b.deposit_cents, b.quote.payInFull ? 'full' : 'deposit', baseUrl);
    return { ref: b.ref, checkoutUrl: url };
  });

  route('POST', '/api/bookings/:ref/pay-balance', async ({ params, query, baseUrl }) => {
    const b = authorizedBooking(params.ref, query.t);
    if (b.status !== 'confirmed' || b.balanceCents <= 0) throw new BookingError('There is no balance to pay on this booking.');
    return { checkoutUrl: await startCheckout(b, b.balanceCents, 'balance', baseUrl) };
  });

  route('POST', '/api/leads', ({ body }) => {
    const lead = svc.createLead(body);
    return { ok: true, id: lead.id };
  });

  // Stripe tells us when a payment succeeds. Configure in Stripe → Developers → Webhooks.
  route('POST', '/webhooks/stripe', ({ rawBody, req }) => {
    const event = stripe.verifyWebhook(rawBody, req.headers['stripe-signature']);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      applyStripeSession(event.data.object);
    }
    return { received: true };
  });

  // ---------- Admin API ----------
  route('GET', '/api/admin/summary', () => svc.summary(), { admin: true });
  route('GET', '/api/admin/bookings', ({ query }) => svc.list({ from: query.from, to: query.to, status: query.status }).map(adminView), { admin: true });
  route('GET', '/api/admin/bookings/:id', ({ params }) => {
    const b = svc.get(Number(params.id));
    if (!b) throw notFound();
    return { ...adminView(b), payments: svc.payments(b.id) };
  }, { admin: true });
  route('POST', '/api/admin/bookings/:id/payment', ({ params, body }) => {
    const methods = ['card_in_person', 'cash', 'check'];
    if (!methods.includes(body.method)) throw new BookingError('Choose card, cash or check.');
    const b = svc.get(Number(params.id));
    if (!b) throw notFound();
    const amountCents = Math.round(Number(body.amount) * 100);
    const kind = b.paid_cents === 0 ? (amountCents >= b.total_cents ? 'full' : 'deposit') : 'balance';
    return adminView(svc.recordPayment(b.id, { kind, method: body.method, amountCents, note: body.note }));
  }, { admin: true });
  route('POST', '/api/admin/bookings/:id/cancel', ({ params, body }) => adminView(svc.cancel(Number(params.id), body.reason)), { admin: true });
  // The customer's booking page has a "Pay balance" button, so that page is the link to send.
  route('POST', '/api/admin/bookings/:id/balance-link', ({ params, baseUrl }) => {
    const b = svc.get(Number(params.id));
    if (!b) throw notFound();
    if (b.balanceCents <= 0) throw new BookingError('Nothing owed on this booking.');
    return { customerPage: customerUrl(b, baseUrl) };
  }, { admin: true });
  route('GET', '/api/admin/leads', () => svc.listLeads(), { admin: true });

  // Staff calendar & closures
  route('GET', '/api/admin/calendar', ({ query }) => svc.adminMonth(String(query.month || '')), { admin: true });
  route('POST', '/api/admin/blocks', ({ body }) => svc.addBlock(body), { admin: true });
  route('DELETE', '/api/admin/blocks/:id', ({ params }) => { svc.removeBlock(Number(params.id)); return { ok: true }; }, { admin: true });
  route('GET', '/api/admin/calendar-feed', ({ baseUrl }) => ({ url: `${baseUrl}/feeds/${feedToken()}/parties.ics` }), { admin: true });

  // Pricing (edited from the admin page)
  route('GET', '/api/admin/pricing', () => priceSettings.view(), { admin: true });
  route('PUT', '/api/admin/pricing', ({ body }) => {
    try { priceSettings.save(db, body); } catch (e) { throw new BookingError(e.message); }
    return priceSettings.view();
  }, { admin: true });
  route('POST', '/api/admin/pricing/reset', () => { priceSettings.reset(db); return priceSettings.view(); }, { admin: true });

  // Emails
  route('GET', '/api/admin/emails', () => ({ enabled: notifier.enabled, emails: notifier.list() }), { admin: true });
  route('GET', '/api/admin/emails/:id/preview', ({ params }) => {
    const e = notifier.get(Number(params.id));
    if (!e) throw notFound();
    return html(e.html);
  }, { admin: true });
  route('POST', '/api/admin/emails/:id/resend', ({ params }) => {
    if (!notifier.resend(Number(params.id))) throw notFound();
    kick();
    return { ok: true };
  }, { admin: true });
  route('POST', '/api/admin/emails/run', async () => ({ queued: notifier.queueReminders(), sent: await notifier.flush() }), { admin: true });

  // QuickBooks
  route('GET', '/api/admin/quickbooks', () => qbo.status(), { admin: true });
  route('POST', '/api/admin/quickbooks/sync', async () => ({ ...(await qbo.syncPending()), status: qbo.status() }), { admin: true });
  route('POST', '/api/admin/quickbooks/retry/:paymentId', async ({ params }) => { qbo.retry(Number(params.paymentId)); await qbo.syncPending(); return qbo.status(); }, { admin: true });
  route('POST', '/api/admin/quickbooks/disconnect', async () => { await qbo.disconnect(); return qbo.status(); }, { admin: true });
  route('PATCH', '/api/admin/leads/:id', ({ params, body }) => svc.updateLead(Number(params.id), body), { admin: true });
  route('GET', '/api/admin/export/bookings.csv', () => csv(
    ['Ref', 'Status', 'Party date', 'Start', 'Package', 'Kids', 'Child', 'Parent', 'Email', 'Phone', 'Subtotal', 'Tax', 'Total', 'Paid', 'Balance', 'Balance due'],
    svc.list().map((b) => [b.ref, b.status, b.party_date, b.timeLabel, b.packageName, b.kids, b.child_name, b.parent_name, b.email, b.phone,
      dollars(b.quote.subtotalCents), dollars(b.quote.taxCents), dollars(b.total_cents), dollars(b.paid_cents), dollars(b.balanceCents), b.balance_due_date])), { admin: true });
  // Payments export in a shape that maps easily to QuickBooks Online "Sales Receipt" import.
  route('GET', '/api/admin/export/payments.csv', () => csv(
    ['Date', 'Booking ref', 'Customer', 'Email', 'Type', 'Method', 'Amount', 'Party date', 'Stripe payment'],
    db.prepare(`SELECT p.*, b.ref, b.parent_name, b.email, b.party_date FROM payments p JOIN bookings b ON b.id = p.booking_id ORDER BY p.id`).all()
      .map((p) => [p.created_at.slice(0, 10), p.ref, p.parent_name, p.email, p.kind, p.method, dollars(p.amount_cents), p.party_date, p.stripe_payment_intent])), { admin: true });

  // ---------- Helpers ----------
  async function startCheckout(b, amountCents, kind, baseUrl) {
    const back = customerUrl(b, baseUrl);
    if (!stripe.enabled()) {
      return `${baseUrl}/pay/demo?ref=${b.ref}&t=${b.token}&kind=${kind}&amount=${amountCents}`;
    }
    const kindLabel = { deposit: `${config.payments.depositPercent}% non-refundable deposit`, balance: 'Remaining balance', full: 'Paid in full' }[kind];
    const session = await stripe.createCheckout({
      amountCents,
      currency: config.payments.currency,
      productName: `${b.packageName} — ${b.party_date} ${b.timeLabel}`,
      description: `${config.business.name} party ${b.ref}: ${kindLabel}`,
      email: b.email,
      bookingRef: b.ref,
      kind,
      successUrl: `${back}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: kind === 'balance' ? back : `${baseUrl}/book?cancelled=${b.ref}`,
      expiresInMinutes: b.status === 'pending' ? config.payments.holdMinutes : undefined,
    });
    db.prepare('INSERT INTO checkout_sessions (session_id, booking_id, kind, amount_cents, url) VALUES (?, ?, ?, ?, ?)').run(session.id, b.id, kind, amountCents, session.url);
    return session.url;
  }

  function applyStripeSession(session) {
    if (session.payment_status !== 'paid') return null;
    const row = db.prepare('SELECT * FROM checkout_sessions WHERE session_id = ?').get(session.id);
    if (!row) return null;
    return svc.recordPayment(row.booking_id, { kind: row.kind, method: 'stripe', amountCents: session.amount_total, stripeSessionId: session.id, paymentIntent: session.payment_intent });
  }

  function authorizedBooking(ref, token) {
    const b = svc.getByRef(String(ref));
    if (!b || !token || !safeEqual(b.token, String(token))) throw notFound();
    return b;
  }

  function customerUrl(b, baseUrl) {
    return `${baseUrl}/booking/${b.ref}?t=${b.token}`;
  }

  // ---------- HTML pages rendered on the server ----------
  async function bookingPage({ params, query, baseUrl }) {
    let b = authorizedBooking(params.ref, query.t);
    let notice = '';
    if (query.session_id && stripe.enabled()) {
      // Confirm payment right away instead of waiting for the webhook.
      try {
        const s = await stripe.getCheckout(String(query.session_id));
        if (s.client_reference_id === b.ref) b = applyStripeSession(s) || svc.get(b.id);
      } catch (e) { console.error(e); }
    }
    if (query.paid) notice = 'Payment received — thank you!';
    return html(renderBooking(b, svc.payments(b.id), notice, baseUrl));
  }

  function demoPayPage({ query }) {
    if (stripe.enabled()) throw notFound();
    const b = authorizedBooking(query.ref, query.t);
    return html(layout('Demo payment', `
      <div class="card">
        <p class="banner">DEMO MODE — Stripe is not connected yet, so no real card is charged.</p>
        <h1>Pay ${money(Number(query.amount))}</h1>
        <p>${esc(b.packageName)} on ${esc(fmtDate(b.party_date))} at ${esc(b.timeLabel)} · Booking ${esc(b.ref)}</p>
        <form method="post" action="/pay/demo?ref=${esc(b.ref)}&t=${esc(b.token)}&kind=${esc(query.kind)}&amount=${esc(query.amount)}">
          <button class="btn">Simulate successful payment</button>
        </form>
      </div>`));
  }

  function demoPaySubmit({ query, baseUrl }) {
    if (stripe.enabled()) throw notFound();
    const b = authorizedBooking(query.ref, query.t);
    svc.recordPayment(b.id, { kind: String(query.kind), method: 'demo', amountCents: Number(query.amount), stripeSessionId: `demo_${crypto.randomUUID()}` });
    return { redirect: `${customerUrl(b, baseUrl)}&paid=1` };
  }

  // ---------- HTTP plumbing ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const baseUrl = (process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, '');
    const pathname = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    try {
      if (opts.expireHolds !== false) svc.expireHolds();

      // Pages
      if (req.method === 'GET' && (pathname === '/' || pathname === '/book')) return sendFile(res, 'book.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/calendar') return sendFile(res, 'calendar.html', { embeddable: true });
      const feed = /^\/feeds\/([^/]+)\/parties\.ics$/.exec(pathname);
      if (req.method === 'GET' && feed) {
        if (!process.env.ADMIN_PASSWORD || !safeEqual(feed[1], feedToken())) return send(res, { error: 'Not found' }, 404);
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(icsFeed());
      }
      if (req.method === 'GET' && pathname === '/admin') {
        if (!adminOk(req)) return askForLogin(res);
        return sendFile(res, 'admin.html');
      }
      const bm = /^\/booking\/([^/]+)$/.exec(pathname);
      if (req.method === 'GET' && bm) return send(res, await bookingPage({ params: { ref: bm[1] }, query: Object.fromEntries(url.searchParams), baseUrl }));
      if (pathname === '/pay/demo') {
        const ctx = { query: Object.fromEntries(url.searchParams), baseUrl };
        if (req.method === 'POST') { const r = demoPaySubmit(ctx); kick(); return send(res, r); }
        return send(res, demoPayPage(ctx));
      }
      if (req.method === 'GET' && pathname === '/static/theme.css') return sendTheme(res);
      if (req.method === 'GET' && pathname.startsWith('/static/')) return sendFile(res, pathname.slice(8), { embeddable: true });
      if (req.method === 'GET' && (pathname === '/quickbooks/connect' || pathname === '/quickbooks/callback')) {
        if (!adminOk(req)) return askForLogin(res);
        if (pathname === '/quickbooks/connect') return send(res, { redirect: qbo.authorizeUrl() });
        try {
          await qbo.handleCallback(Object.fromEntries(url.searchParams));
          kick();
          return send(res, { redirect: '/admin?qbo=connected#settings' });
        } catch (e) {
          return send(res, { redirect: `/admin?qbo_error=${encodeURIComponent(e.message)}#settings` });
        }
      }
      if (pathname === '/healthz') return send(res, { ok: true });

      // API
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (r.admin && !adminOk(req)) return send(res, { error: 'Admin login required' }, 401);
        const rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : '';
        let body = {};
        if (rawBody && !pathname.startsWith('/webhooks/')) {
          try { body = JSON.parse(rawBody); } catch { throw new BookingError('Invalid request.'); }
        }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const result = await r.handler({ req, params, query: Object.fromEntries(url.searchParams), body, rawBody, baseUrl });
        if (req.method !== 'GET') kick();
        return send(res, result);
      }
      return send(res, { error: 'Not found' }, 404);
    } catch (e) {
      if (e instanceof BookingError || e instanceof PricingError) return send(res, { error: e.message }, 400);
      if (e.status === 404) return send(res, { error: 'Not found' }, 404);
      if (pathname.startsWith('/webhooks/')) { console.error('Webhook rejected:', e.message); return send(res, { error: e.message }, 400); }
      console.error(e);
      return send(res, { error: 'Something went wrong. Please call us to book.' }, 500);
    }
  }

  function adminOk(req) {
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) return false;
    const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    const [, pass] = Buffer.from(m[1], 'base64').toString().split(/:(.*)/s);
    return safeEqual(pass || '', pw);
  }

  // Private calendar feed for Google Calendar / iPhone. The secret link changes if ADMIN_PASSWORD changes.
  function feedToken() {
    return crypto.createHmac('sha256', String(process.env.ADMIN_PASSWORD || '')).update('nxgs-ics-feed').digest('hex').slice(0, 32);
  }

  function icsFeed() {
    const now = (opts.clock || (() => new Date()))();
    const from = new Date(now.getTime() - 60 * 86400000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 400 * 86400000).toISOString().slice(0, 10);
    const tz = config.business.timezone;
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const local = (date, min) => `${date.replace(/-/g, '')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
    const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NXGS//Party App//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${text(config.business.shortName + ' Parties')}`, `X-WR-TIMEZONE:${tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
    for (const b of svc.list({ from, to }).filter((x) => ['confirmed', 'paid', 'pending'].includes(x.status))) {
      const end = b.start_min + require('./scheduling').partyMinutes(config);
      const title = `${b.status === 'pending' ? '[HOLD] ' : ''}${b.child_name ? `${b.child_name}'s party` : `${b.parent_name} party`} · ${b.kids} kids`;
      const desc = [`${b.packageName} · Booking ${b.ref}`, `Parent: ${b.parent_name} · ${b.phone} · ${b.email}`,
        b.schedule.map((s) => `${s.from} ${s.label}`).join('\n'),
        b.balanceCents > 0 ? `Balance owed: ${money(b.balanceCents)}${b.balanceOverdue ? ' (OVERDUE)' : ''}` : 'Paid in full',
        b.quote.lines.filter((l) => l.kind === 'addon').map((l) => `+ ${l.name} × ${l.qty}`).join('\n'),
        b.notes ? `Notes: ${b.notes}` : ''].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:${b.ref}@nxgs-party-app`, `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${local(b.party_date, b.start_min)}`, `DTEND;TZID=${tz}:${local(b.party_date, end)}`,
        `SUMMARY:${text(title)}`, `DESCRIPTION:${text(desc)}`, `STATUS:${b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
    }
    for (const k of db.prepare('SELECT * FROM blocks WHERE block_date BETWEEN ? AND ?').all(from, to)) {
      const allDay = k.start_min <= 0 && k.end_min >= 1440;
      const next = new Date(`${k.block_date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      lines.push('BEGIN:VEVENT', `UID:block-${k.id}@nxgs-party-app`, `DTSTAMP:${stamp}`,
        allDay ? `DTSTART;VALUE=DATE:${k.block_date.replace(/-/g, '')}` : `DTSTART;TZID=${tz}:${local(k.block_date, k.start_min)}`,
        allDay ? `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}` : `DTEND;TZID=${tz}:${local(k.block_date, Math.min(k.end_min, 1439))}`,
        `SUMMARY:${text(`Closed for parties${k.reason ? ': ' + k.reason : ''}`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    // Lines over 75 octets must be folded (RFC 5545).
    return lines.map((l) => { let out = ''; let rest = l; while (Buffer.byteLength(rest) > 74) { let cut = 74; while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--; out += rest.slice(0, cut) + '\r\n '; rest = rest.slice(cut); } return out + rest; }).join('\r\n') + '\r\n';
  }

  return { handle, svc, notifier, qbo, background, icsFeed, feedToken };
}

// Brand colors & fonts from config.brand, loaded after style.css.
function sendTheme(res) {
  const b = config.brand;
  const font = b.googleFont ? `@import url('https://fonts.googleapis.com/css2?family=${encodeURI(b.googleFont)}&display=swap');\n` : '';
  const css = `${font}:root { --brand: ${b.primaryColor}; --accent: ${b.accentColor}; --radius: ${Number(b.cornerRadius)}px; }
body { font-family: ${b.fontFamily}; }
@media (prefers-color-scheme: dark) { :root { --brand: color-mix(in srgb, ${b.primaryColor} 70%, white); } }
.page-logo { display: block; max-height: 56px; max-width: 220px; margin: 0 0 10px; }
`;
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(css);
}

// ---------- rendering ----------
function renderBooking(b, payments, notice, baseUrl) {
  const statusText = {
    pending: 'Waiting for payment — your time is held for a short while.',
    confirmed: 'Confirmed — deposit received.',
    paid: 'Confirmed — paid in full.',
    cancelled: 'Cancelled.',
    expired: 'This hold expired before payment. Please book again or call us.',
  }[b.status];
  const lines = b.quote.lines.map((l) => `<tr><td>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</td><td class="num">${money(l.totalCents)}</td></tr>`).join('');
  const pays = payments.map((p) => `<tr><td>${esc(p.created_at.slice(0, 10))} · ${esc(p.kind)} (${esc(p.method.replace(/_/g, ' '))})</td><td class="num">−${money(p.amount_cents)}</td></tr>`).join('');
  const canPayBalance = b.status === 'confirmed' && b.balanceCents > 0;
  return layout(`Party ${b.ref}`, `
    <div class="card">
      ${notice ? `<p class="banner ok">${esc(notice)}</p>` : ''}
      <figure class="hero"><img src="/static/img/lobby.jpg" alt="NXGS front desk and lobby"><figcaption>Rendering · NXGS Farmingdale</figcaption></figure>
      <p class="eyebrow">${esc(config.business.name)} · Booking ${esc(b.ref)}</p>
      <h1>${b.child_name ? `${esc(b.child_name)}'s party` : 'Your party'}</h1>
      <p class="status status-${esc(b.status)}">${esc(statusText)}</p>
      <dl class="facts">
        <dt>Date</dt><dd>${esc(fmtDate(b.party_date))}</dd>
        <dt>Time</dt><dd>${esc(b.timeLabel)} – ${esc(b.endLabel)}</dd>
        <dt>Package</dt><dd>${esc(b.packageName)}</dd>
        <dt>Kids</dt><dd>${b.kids}</dd>
      </dl>
      <h2>Schedule</h2>
      <ul class="schedule">${b.schedule.map((s) => `<li><span>${esc(s.from)}</span> ${esc(s.label)}</li>`).join('')}</ul>
      <h2>Receipt</h2>
      <table class="receipt">
        ${lines}
        <tr class="sub"><td>Subtotal</td><td class="num">${money(b.quote.subtotalCents)}</td></tr>
        <tr><td>${esc(config.tax.label)}</td><td class="num">${money(b.quote.taxCents)}</td></tr>
        <tr class="total"><td>Total</td><td class="num">${money(b.total_cents)}</td></tr>
        ${pays}
        <tr class="total"><td>Balance</td><td class="num">${money(b.balanceCents)}</td></tr>
      </table>
      ${b.balanceCents > 0 && b.balance_due_date && b.status === 'confirmed' ? `<p class="muted">Balance due by ${esc(fmtDate(b.balance_due_date))}.</p>` : ''}
      <p class="muted">The ${config.payments.depositPercent}% deposit is non-refundable.</p>
      <div class="actions">
        ${canPayBalance ? `<button class="btn" id="payBalance">Pay balance ${money(b.balanceCents)}</button>` : ''}
        <button class="btn ghost" onclick="window.print()">Print</button>
      </div>
      <p class="muted">Questions? Email <a href="mailto:${esc(config.business.email)}">${esc(config.business.email)}</a>. Keep this page's link — it's your receipt.</p>
    </div>
    ${canPayBalance ? `<script>
      document.getElementById('payBalance').onclick = async (e) => {
        e.target.disabled = true;
        const r = await fetch('/api/bookings/${b.ref}/pay-balance?t=${b.token}', { method: 'POST' });
        const d = await r.json();
        if (d.checkoutUrl) location.href = d.checkoutUrl; else { alert(d.error); e.target.disabled = false; }
      };
    </script>` : ''}`);
}

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"><link rel="stylesheet" href="/static/theme.css"></head><body class="page"><main>${config.brand.logoUrl ? `<img class="page-logo" src="${esc(config.brand.logoUrl)}" alt="${esc(config.business.name)}">` : ''}${body}</main></body></html>`;
}

function adminView(b) {
  const { token, quote_json, ...rest } = b;
  return rest;
}

const fmtDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dollars = (c) => (c / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const notFound = () => Object.assign(new Error('Not found'), { status: 404 });
const html = (s) => ({ __html: s });

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function csv(header, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return { __csv: [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) { reject(new BookingError('Request too large.')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, result, status = 200) {
  if (result && result.redirect) { res.writeHead(303, { Location: result.redirect }); return res.end(); }
  if (result && result.__html !== undefined) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN' });
    return res.end(result.__html);
  }
  if (result && result.__csv !== undefined) {
    res.writeHead(status, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment' });
    return res.end(result.__csv);
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(result));
}

function sendFile(res, rel, { embeddable = false } = {}) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, { error: 'Not found' }, 404);
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  if (embeddable) {
    // Lets nxgs.net (Base44 now, WordPress later) show the booking page in an iframe.
    const origins = process.env.EMBED_ORIGINS || '*';
    headers['Content-Security-Policy'] = `frame-ancestors ${origins === '*' ? '*' : `'self' ${origins}`}`;
  } else {
    headers['X-Frame-Options'] = 'DENY';
    headers['Cache-Control'] = 'no-store';
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function askForLogin(res) {
  if (!process.env.ADMIN_PASSWORD) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('Admin is turned off. Set the ADMIN_PASSWORD environment variable to enable it.');
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="NXGS Admin"', 'Content-Type': 'text/plain' });
  res.end('Login required');
}

function start() {
  const db = require('./db').open();
  const app = createApp(db);
  const port = Number(process.env.PORT || 3000);
  const run = () => app.background().catch((e) => console.error('Background job failed:', e));
  setInterval(run, 5 * 60 * 1000).unref();
  setTimeout(run, 2000).unref();
  http.createServer(app.handle).listen(port, () => {
    console.log(`NXGS Party App running at http://localhost:${port}`);
    console.log(`  Booking page: http://localhost:${port}/book`);
    console.log(`  Admin:        http://localhost:${port}/admin ${process.env.ADMIN_PASSWORD ? '' : '(set ADMIN_PASSWORD to enable)'}`);
    console.log(`  Payments:     ${stripe.enabled() ? 'Stripe' : 'DEMO MODE (set STRIPE_SECRET_KEY for real payments)'}`);
    console.log(`  Emails:       ${app.notifier.enabled ? 'sending via Resend' : 'recorded only (set RESEND_API_KEY to send)'}`);
    console.log(`  QuickBooks:   ${app.qbo.configured() ? (app.qbo.connected() ? 'connected' : 'ready — connect from Admin') : 'off (set QBO_CLIENT_ID / QBO_CLIENT_SECRET)'}`);
  });
}

if (require.main === module) start();

module.exports = { createApp };
