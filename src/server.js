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
const { createAssistant } = require('./assistant');
const { createGuests } = require('./guests');
const { createGifts } = require('./gifts');
const { createReviews } = require('./reviews');
const media = require('./media');
const { createSponsors } = require('./sponsors');
const { createMarketplace } = require('./marketplace');
const { createWaitlist } = require('./waitlist');
const { createAudience } = require('./audience');
const { createCheckin } = require('./checkin');
const { createInsights } = require('./insights');
const site = require('./site');
const i18n = require('./i18n');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function createApp(db, opts = {}) {
  site.applySetup(db);      // facility name, brand and locations from Admin → Setup
  priceSettings.apply(db); // admin price edits laid over config.js starting prices
  const hooks = { onPayment: [], onLead: [], onExpire: [], onCancel: [], onReschedule: [], onCustomerCancel: [], onVideo: [], onSlotOpened: [] };
  const svc = createService(db, config, opts.clock, hooks);
  const audience = createAudience(db, { clock: opts.clock });
  const guests = createGuests(db, svc, { clock: opts.clock, audience });
  const sponsors = createSponsors(db, { clock: opts.clock });
  const notifier = createNotifier(db, svc, { issueCredit: (a) => gifts.createManual(a), clock: opts.clock, sender: opts.emailSender, smsSender: opts.smsSender, baseUrl: opts.baseUrl, guests, sponsors, audience });
  const waitlist = createWaitlist(db, svc, { clock: opts.clock, hooks: { onWaitlistOpen: [notifier.onWaitlistOpen] } });
  const checkin = createCheckin(db, svc, guests, { clock: opts.clock });
  const insights = createInsights(db, svc);
  const marketplace = createMarketplace(db, { hooks: { onVendorOrder: [notifier.onVendorOrder], onVendorApplied: [notifier.onVendorApplied] } });
  /** Rebuild the add-on list: starting prices + admin edits + live partner products. */
  const refreshCatalog = () => { site.applySetup(db); priceSettings.apply(db); marketplace.apply(config); };
  refreshCatalog();
  const qbo = createQuickBooks(db, { clock: opts.clock, fetch: opts.qboFetch });
  const gifts = createGifts(db, svc, { hooks: { onGiftActivated: [notifier.onGiftActivated], onReferralCredit: [notifier.onReferralCredit] } });
  const reviews = createReviews(db, svc, { clock: opts.clock });
  hooks.onPayment.push(notifier.onPayment, qbo.onPayment, gifts.onPayment, marketplace.onPayment, (b) => waitlist.onBooked(b));
  // A time may have opened up: tell anyone on that day's waitlist.
  const opened = (id) => { const b = svc.get(id); if (b) waitlist.slotOpened(b.party_date, b.location_id); };
  hooks.onCancel.push(marketplace.onCancel, opened);
  hooks.onExpire.push((id) => gifts.releaseHeld(id), opened);
  hooks.onSlotOpened.push((date, loc) => waitlist.slotOpened(date, loc));
  hooks.onVideo.push(notifier.onVideo);
  hooks.onReschedule.push((b, info) => {
    // Paid more than the new price: give the difference back as party credit.
    let credit = null;
    if (info.overpaidCents > 0) credit = gifts.createManual({ amount: info.overpaidCents / 100, recipientName: b.parent_name, recipientEmail: b.email, message: `Credit from moving party ${b.ref}` });
    waitlist.slotOpened(info.fromDate, b.location_id);
    notifier.onReschedule(b, { ...info, credit });
  });
  const assistant = createAssistant(db, svc, { clock: opts.clock, runner: opts.assistantRunner, fetch: opts.assistantFetch, waitlist });
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

  // Customers can only book or browse public locations; staff can use any.
  function publicLocationId(id) {
    const l = config.locations.find((x) => x.id === (id || config.defaultLocation));
    if (!l || !l.public) throw new BookingError('That location is not taking bookings yet.');
    return l.id;
  }
  const partyDaysFor = (id) => Object.entries(svc.locCfg(id).partyHours).filter(([, h]) => h).map(([d]) => Number(d));

  // ---------- Public API ----------
  route('GET', '/api/config', ({ query }) => i18n.localizeConfig(publicConfig(), query.lang));
  route('GET', '/api/site', ({ query }) => site.publicSite(db, i18n.lang(query.lang)));
  const publicConfig = () => ({
    business: { name: config.business.name, shortName: config.business.shortName, website: config.business.website, address: config.business.address, phone: config.business.phone, email: config.business.email },
    shirtSizes: config.details.shirtSizes,
    themes: config.themes,
    referral: config.referral,
    giftCards: config.giftCards,
    brand: { logoUrl: config.brand.logoUrl },
    packages: config.packages.filter((p) => p.active !== false).map((p) => ({ ...p, phases: p.phases || config.party.phases })),
    addOns: config.addOns.filter((a) => a.active !== false).map(({ costCents, vendor, ...a }) => a), // never expose cost or vendor
    addOnCategories: config.addOnCategories,
    inquiryTypes: config.inquiryTypes.filter((t) => !t.hidden),
    sponsorPackages: config.sponsorPackages.map(({ suggestedMonthlyCents, ...p }) => p),
    marketplace: { payoutTerms: config.marketplace.payoutTerms },
    party: { phases: config.party.phases, maxKids: config.party.maxKids },
    payments: { depositPercent: config.payments.depositPercent, balanceDueDaysBefore: config.payments.balanceDueDaysBefore, depositRefundable: config.payments.depositRefundable, holdMinutes: config.payments.holdMinutes },
    tax: config.tax,
    minDaysAhead: config.minDaysAhead,
    maxDaysAhead: config.maxDaysAhead,
    partyDays: partyDaysFor(config.defaultLocation),
    locations: config.locations.filter((l) => l.public).map((l) => ({ id: l.id, name: l.name, shortName: l.shortName, address: l.address, phone: l.phone, partyDays: partyDaysFor(l.id) })),
    defaultLocation: config.defaultLocation,
    reviewMinChars: config.reviews.minChars || 100,
    stripe: stripe.enabled(),
    assistant: { enabled: assistant.enabled(), name: assistant.name() },
    compareRows: config.compareRows || [],
    timePricing: (config.timePricing || []).filter((r) => r.active !== false && r.adjustCents).map(({ id, label, days, from, to, adjustCents }) => ({ id, label, days, from, to, adjustCents })),
    changes: config.changes,
    languages: config.languages || ['en'],
    guestOffer: { programsText: config.guestOffer?.programsText || null },
  });

  // Chat assistant. Works from our own pages and, via CORS, from the nxgs.net site.
  route('POST', '/api/chat', ({ body, req, baseUrl }) => assistant.chat({
    sessionId: body.sessionId,
    message: body.message,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress,
    checkout: (b, code) => checkoutForNewBooking(b, code, baseUrl),
    checkCode: (input) => quoteWithCode(input),
  }));

  route('GET', '/api/availability', ({ query }) => svc.availability(String(query.date || ''), publicLocationId(query.location), query.package || null));

  route('POST', '/api/quote', ({ body }) => localizeQuote(quoteWithCode(body), body.lang));

  // Live availability calendar (public: open/full only, never who booked).
  route('GET', '/api/calendar', ({ query }) => svc.calendarMonth(String(query.month || ''), publicLocationId(query.location)));

  route('POST', '/api/bookings', async ({ body, baseUrl }) => {
    quoteWithCode(body); // checks a gift card or referral code before anything is held
    const b = svc.create({ ...body, locationId: publicLocationId(body.locationId) });
    if (body.marketingOptIn) audience.optIn({ email: b.email, name: b.parent_name, childName: b.child_name, phone: b.phone, source: 'booking', bookingId: b.id, lang: b.lang });
    const url = await checkoutForNewBooking(b, body.code, baseUrl);
    return { ref: b.ref, checkoutUrl: url };
  });

  // The customer's booking page (also the receipt).
  route('GET', '/api/bookings/:ref', async ({ params, query }) => {
    let b = authorizedBooking(params.ref, query.t);
    if (query.session_id && stripe.enabled()) {
      // Confirm payment right away instead of waiting for the webhook.
      try {
        const sess = await stripe.getCheckout(String(query.session_id));
        if (sess.client_reference_id === b.ref) { applyStripeSession(sess); b = svc.get(b.id); }
      } catch (e) { console.error(e); }
    }
    return customerView(b, query.lang);
  });
  // Families moving or cancelling their own party.
  route('GET', '/api/bookings/:ref/times', ({ params, query }) => {
    const b = authorizedBooking(params.ref, query.t);
    const c = svc.canReschedule(b);
    if (!c.ok) throw new BookingError(c.reason);
    return svc.rescheduleTimes(b.id, String(query.date || ''));
  });
  route('POST', '/api/bookings/:ref/reschedule', ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    svc.reschedule(b.id, { date: String(body.date || ''), time: String(body.time || '') });
    return customerView(svc.get(b.id), body.lang);
  });
  route('POST', '/api/bookings/:ref/cancel', async ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    if (String(body.confirm || '').toUpperCase() !== 'CANCEL') throw new BookingError('Type CANCEL to confirm.');
    const terms = svc.cancelTerms(b);
    const done = svc.customerCancel(b.id, body.reason);
    const refundedCents = await refundToCard(done, terms.refundCents);
    notifier.onCustomerCancel(svc.get(b.id), terms, { refundedCents });
    return customerView(svc.get(b.id), body.lang);
  });
  route('POST', '/api/bookings/:ref/lang', ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    db.prepare('UPDATE bookings SET lang = ? WHERE id = ?').run(i18n.lang(body.lang), b.id);
    return { ok: true };
  });
  route('POST', '/api/bookings/:ref/details', ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    const input = { ...body };
    delete input.photo;
    if (body.photoDataUrl) {
      try { input.photo = media.saveDataUrl(db, body.photoDataUrl, { maxBytes: 2_500_000 }); } catch (e) { throw new BookingError(e.message); }
      if (b.details?.photo) media.remove(db, b.details.photo);
    }
    svc.saveDetails(b.id, input);
    return customerView(svc.get(b.id), body.lang);
  });
  route('POST', '/api/bookings/:ref/gift-card', ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    const r = gifts.applyToBalance(b.id, body.code);
    return { ...r, booking: customerView(svc.get(b.id), body.lang) };
  });
  route('POST', '/api/bookings/:ref/review', ({ params, query, body }) => {
    const b = authorizedBooking(params.ref, query.t);
    return reviews.submit(b.id, body);
  });

  // Parent portal: open the party page with the booking email + the access code from the confirmation email.
  const portalTries = new Map();   // ip -> { n, reset }
  function portalGuard(req) {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'x';
    const now = Date.now();
    const t = portalTries.get(ip);
    if (!t || t.reset < now) { portalTries.set(ip, { n: 1, reset: now + 15 * 60000 }); return; }
    if (++t.n > 12) throw new BookingError('Too many tries. Please wait a few minutes and try again.');
  }
  route('POST', '/api/portal/login', ({ req, body }) => {
    portalGuard(req);
    const b = svc.findByAccess(body.email, body.code);
    if (!b) throw new BookingError("We couldn't find a party with that email and code. Check the code in your confirmation email, or tap “Email me my code”.");
    return { url: `/booking/${b.ref}?t=${b.token}` };
  });
  route('POST', '/api/portal/resend', ({ req, body }) => {
    portalGuard(req);
    notifier.sendAccessCodes(svc.activeByEmail(body.email));
    kick();
    return { ok: true };   // same answer whether or not the address has a party, so nobody can probe who has booked
  });

  // Invitations, RSVPs and waivers
  route('GET', '/api/invite/:token', ({ params }) => guests.invitation(params.token) || (() => { throw notFound(); })());
  route('POST', '/api/invite/:token/rsvp', ({ params, body }) => {
    const r = guests.rsvp(params.token, body);
    return { ...r, checkinPass: r.attending === 'yes' ? checkin.passForRsvp(r.rsvpToken) : null };
  });
  route('GET', '/api/invite/:token/pass', ({ params, query }) => {
    const b = svc.getByInvite(params.token);
    const r = b && db.prepare(`SELECT token FROM rsvps WHERE token = ? AND booking_id = ? AND attending = 'yes'`).get(String(query.r || ''), b.id);
    if (!r) throw notFound();
    return { checkinPass: checkin.passForRsvp(r.token) };
  });
  route('GET', '/api/waiver', ({ query }) => guests.waiverText(i18n.lang(query.lang)));
  route('POST', '/api/waitlist', ({ body }) => waitlist.join({ ...body, locationId: publicLocationId(body.locationId) }));
  route('POST', '/api/waivers', ({ body, req }) => guests.signWaiver(body, { ip: clientIp(req), userAgent: req.headers['user-agent'] }));

  // Gift cards
  route('POST', '/api/gift-cards', async ({ body, baseUrl }) => {
    const card = gifts.createPending(body);
    return { checkoutUrl: await startGiftCheckout(card, baseUrl) };
  });
  route('GET', '/api/gift-cards/status', async ({ query }) => {
    let card = null;
    if (query.session_id && stripe.enabled()) {
      const sess = await stripe.getCheckout(String(query.session_id));
      applyStripeSession(sess);
      const row = db.prepare('SELECT gift_card_id FROM gift_sessions WHERE session_id = ?').get(sess.id);
      if (row) card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(row.gift_card_id);
    } else if (query.code && !stripe.enabled()) {
      card = gifts.find(query.code);
    }
    if (!card || card.status !== 'active') return { active: false };
    return { active: true, code: card.code, amountCents: card.initial_cents, recipientName: card.recipient_name, recipientEmail: card.recipient_email };
  });
  route('GET', '/api/gift-cards/balance', ({ query }) => {
    const c = gifts.find(query.code);
    if (!c || c.status === 'pending') throw new BookingError("We couldn't find that code.");
    return { code: c.code, status: c.status, balanceCents: c.status === 'active' ? c.balanceCents : 0 };
  });

  // Sponsors (logo strips on public pages) and the Partners page
  route('GET', '/api/sponsors', ({ query }) => ({ sponsors: sponsors.forPlacement(String(query.placement || ''), query.location || config.defaultLocation, { count: true }) }));
  route('POST', '/api/partners/vendor', ({ body }) => marketplace.applyAsVendor(body));
  route('POST', '/api/partners/sponsor', ({ body }) => {
    const lead = svc.createLead({ eventType: 'sponsor', name: body.name, organization: body.organization, email: body.email, phone: body.phone,
      message: [body.packageId ? `Interested in: ${config.sponsorPackages.find((p) => p.id === body.packageId)?.name || body.packageId}` : '', body.message].filter(Boolean).join('\n') });
    return { ok: true, id: lead.id };
  });
  route('GET', '/api/partners/corporate', () => marketplace.corporateCatalog());

  // Reviews shown on the booking page (only parent-permitted, staff-approved ones)
  route('GET', '/api/reviews', () => reviews.publicList());

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
  route('GET', '/api/admin/locations', () => config.locations, { admin: true });
  route('GET', '/api/admin/summary', ({ query }) => svc.summary(query.location || null), { admin: true });
  route('GET', '/api/admin/bookings', ({ query }) => svc.list({ from: query.from, to: query.to, status: query.status, locationId: query.location || undefined }).map(adminView), { admin: true });
  route('GET', '/api/admin/bookings/:id', ({ params }) => {
    const b = svc.get(Number(params.id));
    if (!b) throw notFound();
    return { ...adminView(b), payments: svc.payments(b.id), detailsStatus: svc.detailsStatus(b), guests: guests.partyGuests(b.id), review: reviews.forBooking(b.id),
      checkin: ['confirmed', 'paid'].includes(b.status) ? { arrived: checkin.roster(b.id).arrived } : null };
  }, { admin: true });
  route('PATCH', '/api/admin/bookings/:id', ({ params, body }) => {
    const b = svc.get(Number(params.id));
    if (!b) throw notFound();
    if (body.hostName !== undefined) svc.setHost(b.id, body.hostName);
    if (body.videoUrl !== undefined) svc.setVideo(b.id, body.videoUrl);
    return adminView(svc.get(b.id));
  }, { admin: true });
  route('GET', '/api/admin/runsheet', ({ query }) => runSheet(String(query.date || ''), query.location || null), { admin: true });
  route('POST', '/api/admin/bookings/:id/reschedule', ({ params, body }) => adminView(svc.reschedule(Number(params.id), { date: String(body.date || ''), time: String(body.time || '') }, { staff: true }).booking), { admin: true });
  route('GET', '/api/admin/bookings/:id/times', ({ params, query }) => svc.rescheduleTimes(Number(params.id), String(query.date || '')), { admin: true });
  route('POST', '/api/admin/bookings/:id/refunded', ({ params, body }) => {
    const amountCents = Math.round(Number(body.amount) * 100);
    return adminView(svc.recordRefund(Number(params.id), { amountCents, method: ['cash', 'check', 'card_in_person', 'gift_card', 'stripe'].includes(body.method) ? body.method : 'manual', note: body.note }));
  }, { admin: true });

  // Insights, waitlist and the marketing list
  route('GET', '/api/admin/insights', ({ query }) => insights.report({ from: query.from, to: query.to, locationId: query.location || null }), { admin: true });
  route('GET', '/api/admin/growth', () => ({ waitlist: waitlist.list(), waitlistStats: waitlist.stats(), audience: audience.stats(), contacts: audience.list().slice(0, 300),
    recovery: { sent: db.prepare("SELECT COUNT(*) n FROM emails WHERE kind = 'hold_recovery'").get().n, booked: db.prepare("SELECT COUNT(*) n FROM bookings WHERE source = 'recovery' AND status IN ('confirmed','paid')").get().n } }), { admin: true });
  route('DELETE', '/api/admin/waitlist/:id', ({ params }) => { waitlist.remove(Number(params.id)); return { ok: true }; }, { admin: true });
  route('GET', '/api/admin/export/contacts.csv', () => csv(['Email', 'Name', 'Child', 'Phone', 'Language', 'From', 'Party', 'Opted in'],
    audience.list().filter((c) => !c.unsubscribed_at).map((c) => [c.email, c.name, c.child_name, c.phone, c.lang, c.source, c.ref ? `${c.ref} (${c.party_date})` : '', c.opted_in_at.slice(0, 10)])), { admin: true });

  // Door check-in
  route('GET', '/api/admin/checkin', ({ query }) => ({ date: String(query.date || svc.todayLocal()), parties: checkin.partiesOn(String(query.date || svc.todayLocal()), svc.location(query.location).id) }), { admin: true });
  route('GET', '/api/admin/checkin/:id', ({ params }) => checkin.roster(Number(params.id)), { admin: true });
  route('POST', '/api/admin/checkin/:id', ({ params, body }) => checkin.checkIn(Number(params.id), body.name, 'tap'), { admin: true });
  route('DELETE', '/api/admin/checkin/:id/:key', ({ params }) => checkin.undo(Number(params.id), params.key), { admin: true });

  // Website content (photos, video tour, FAQ, Instagram, search page) and facility setup
  route('GET', '/api/admin/site', () => ({ ...site.content(db), faq: site.faq(db, 'en', { includeDrafts: true }) }), { admin: true });
  route('PUT', '/api/admin/site', ({ body }) => { site.saveContent(db, body); return { ...site.content(db), faq: site.faq(db, 'en', { includeDrafts: true }) }; }, { admin: true });
  route('POST', '/api/admin/site/photo', ({ body }) => {
    let p;
    try { p = media.saveDataUrl(db, body.dataUrl, { maxBytes: 2_500_000 }); } catch (e) { throw new BookingError(e.message); }
    site.addPhoto(db, p);
    return { ...site.content(db), faq: site.faq(db, 'en', { includeDrafts: true }) };
  }, { admin: true });
  route('GET', '/api/admin/seo-snippet', ({ baseUrl }) => { const p = site.landing(db, { lang: 'en', baseUrl }); return { body: p.body, jsonLd: p.jsonLd, url: `${baseUrl}/birthday-parties` }; }, { admin: true });
  route('GET', '/api/admin/setup', () => ({ ...site.setupView(db), status: launchStatus() }), { admin: true });
  route('PUT', '/api/admin/setup', ({ body }) => { site.saveSetup(db, body); refreshCatalog(); return { ...site.setupView(db), status: launchStatus() }; }, { admin: true });
  route('POST', '/api/admin/setup/logo', ({ body }) => {
    let p;
    try { p = media.saveDataUrl(db, body.dataUrl, { label: 'logo' }); } catch (e) { throw new BookingError(e.message); }
    site.saveSetup(db, { brand: { ...config.brand, logoUrl: p } });
    return { ...site.setupView(db), status: launchStatus() };
  }, { admin: true });

  // Waivers
  route('GET', '/api/admin/waivers', ({ query }) => guests.searchWaivers(String(query.q || '')), { admin: true });
  route('GET', '/api/admin/waivers/:id', ({ params }) => guests.getWaiver(Number(params.id)) || (() => { throw notFound(); })(), { admin: true });
  route('GET', '/api/admin/waiver-text', () => guests.waiverText(), { admin: true });
  route('PUT', '/api/admin/waiver-text', ({ body }) => guests.setWaiverText(body.text, body.lang === 'es' ? 'es' : 'en'), { admin: true });
  route('GET', '/api/admin/waiver-text-es', () => ({ text: guests.spanishWaiver() }), { admin: true });

  // Gift cards & referral credits
  route('GET', '/api/admin/gift-cards', () => gifts.list(), { admin: true });
  route('POST', '/api/admin/gift-cards', ({ body }) => gifts.createManual(body), { admin: true });
  route('POST', '/api/admin/gift-cards/:id/void', ({ params }) => { gifts.voidCard(Number(params.id)); return { ok: true }; }, { admin: true });

  // Sponsors
  route('GET', '/api/admin/sponsors', () => ({ sponsors: sponsors.list(), totals: sponsors.totals(), packages: config.sponsorPackages, placements: sponsors.PLACEMENTS, locations: config.locations.map(({ id, name }) => ({ id, name })) }), { admin: true });
  route('POST', '/api/admin/sponsors', ({ body }) => sponsors.create(body), { admin: true });
  route('PATCH', '/api/admin/sponsors/:id', ({ params, body }) => sponsors.update(Number(params.id), body), { admin: true });
  route('POST', '/api/admin/sponsors/:id/logo', ({ params, body }) => {
    let path;
    try { path = media.saveDataUrl(db, body.dataUrl, { label: 'logo' }); } catch (e) { throw new BookingError(e.message); }
    media.remove(db, sponsors.setLogo(Number(params.id), path));
    return sponsors.get(Number(params.id));
  }, { admin: true });

  // Marketplace (outside vendors)
  route('GET', '/api/admin/marketplace', () => ({ vendors: marketplace.listVendors(), orders: marketplace.listOrders(), totals: marketplace.totals(), defaultMarkupPercent: config.marketplace.defaultMarkupPercent, payoutTerms: config.marketplace.payoutTerms }), { admin: true });
  route('GET', '/api/admin/vendors/:id', ({ params }) => marketplace.getVendor(Number(params.id)) || (() => { throw notFound(); })(), { admin: true });
  route('PATCH', '/api/admin/vendors/:id', ({ params, body }) => marketplace.updateVendor(Number(params.id), body), { admin: true });
  route('POST', '/api/admin/vendors/:id/products', ({ params, body }) => marketplace.saveProduct(Number(params.id), null, body), { admin: true });
  route('PATCH', '/api/admin/vendors/:id/products/:pid', ({ params, body }) => marketplace.saveProduct(Number(params.id), Number(params.pid), body), { admin: true });
  route('POST', '/api/admin/products/:pid/photo', ({ params, body }) => {
    let path;
    try { path = media.saveDataUrl(db, body.dataUrl); } catch (e) { throw new BookingError(e.message); }
    media.remove(db, marketplace.setProductPhoto(Number(params.pid), path));
    return { ok: true, photo: path };
  }, { admin: true });
  route('PATCH', '/api/admin/vendor-orders/:id', ({ params, body }) => { marketplace.setOrderStatus(Number(params.id), body.status); return { ok: true }; }, { admin: true });

  // Reviews
  route('GET', '/api/admin/reviews', () => reviews.list(), { admin: true });
  route('POST', '/api/admin/reviews/:id', ({ params, body }) => { reviews.setApproved(Number(params.id), !!body.approved); return { ok: true }; }, { admin: true });
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
  route('GET', '/api/admin/chats', () => ({ enabled: assistant.enabled(), chats: assistant.list() }), { admin: true });
  route('GET', '/api/admin/chats/:id', ({ params }) => assistant.transcript(params.id) || (() => { throw notFound(); })(), { admin: true });

  // Staff calendar & closures
  route('GET', '/api/admin/calendar', ({ query }) => svc.adminMonth(String(query.month || ''), query.location || null), { admin: true });
  route('POST', '/api/admin/blocks', ({ body }) => svc.addBlock(body), { admin: true });
  route('DELETE', '/api/admin/blocks/:id', ({ params }) => { svc.removeBlock(Number(params.id)); return { ok: true }; }, { admin: true });
  route('GET', '/api/admin/calendar-feed', ({ baseUrl }) => ({ url: `${baseUrl}/feeds/${feedToken()}/parties.ics` }), { admin: true });

  // Pricing (edited from the admin page)
  route('GET', '/api/admin/pricing', () => priceSettings.view(), { admin: true });
  route('PUT', '/api/admin/pricing', ({ body }) => {
    try { priceSettings.save(db, body); } catch (e) { throw new BookingError(e.message); }
    refreshCatalog();
    return priceSettings.view();
  }, { admin: true });
  // Product photos for add-ons: the admin page sends a resized JPEG/PNG/WebP as a data URL.
  route('POST', '/api/admin/addons/:id/photo', ({ params, body }) => {
    let path;
    try { path = media.saveDataUrl(db, body.dataUrl); } catch (e) { throw new BookingError(e.message); }
    let old;
    try { old = priceSettings.setPhoto(db, params.id, path); } catch (e) { media.remove(db, path); throw new BookingError(e.message); }
    removeMedia(old);
    refreshCatalog();
    return priceSettings.view();
  }, { admin: true });
  route('DELETE', '/api/admin/addons/:id/photo', ({ params }) => {
    let old;
    try { old = priceSettings.setPhoto(db, params.id, null); } catch (e) { throw new BookingError(e.message); }
    removeMedia(old);
    refreshCatalog();
    return priceSettings.view();
  }, { admin: true });
  function removeMedia(path) {
    media.remove(db, path);
  }

  route('POST', '/api/admin/pricing/reset', () => { priceSettings.reset(db); refreshCatalog(); return priceSettings.view(); }, { admin: true });

  // Emails
  route('GET', '/api/admin/emails', () => ({ enabled: notifier.enabled, smsEnabled: notifier.smsEnabled, emails: notifier.list() }), { admin: true });
  route('GET', '/api/admin/emails/:id/preview', ({ params }) => {
    const e = notifier.get(Number(params.id));
    if (!e) throw notFound();
    return html(e.html);
  }, { admin: true });
  route('GET', '/api/admin/emails/:id/text', ({ params }) => {
    const e = notifier.get(Number(params.id));
    if (!e) throw notFound();
    return { text: e.text };
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
  /** Quote line names and notes in the customer's language. */
  function localizeQuote(q, lang) {
    const L = i18n.lang(lang);
    if (L === 'en') return q;
    return { ...q, packageName: i18n.packageText({ id: q.packageId, name: q.packageName }, L).name, lines: q.lines.map((l) => ({ ...l, name: i18n.lineName(l, L) })),
      notes: (q.notes || []).map((n) => i18n.noteText(n, L)), phases: (q.phases || []).map((p) => ({ ...p, label: i18n.phaseLabel(p.label, L) })) };
  }

  /** Send a family's refund back to their card, newest card payment first. Returns what was refunded. */
  async function refundToCard(b, cents) {
    if (!stripe.enabled() || cents <= 0) return 0;
    let left = cents, done = 0;
    const cardPays = svc.payments(b.id).filter((p) => p.method === 'stripe' && p.amount_cents > 0 && p.stripe_payment_intent).reverse();
    for (const p of cardPays) {
      if (left <= 0) break;
      const already = -db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE kind = 'refund' AND stripe_payment_intent = ?`).get(p.stripe_payment_intent).s;
      const amt = Math.min(left, p.amount_cents - already);
      if (amt <= 0) continue;
      try {
        await stripe.refund({ paymentIntent: p.stripe_payment_intent, amountCents: amt });
        svc.recordRefund(b.id, { amountCents: amt, method: 'stripe', paymentIntent: p.stripe_payment_intent, note: 'Refunded automatically after the family cancelled' });
        left -= amt; done += amt;
      } catch (e) { console.error('Stripe refund failed:', e.message); break; }
    }
    return done;
  }

  /** The launch checklist on Admin → Setup. */
  function launchStatus() {
    const has = (k) => !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
    const c = site.content(db);
    const drafts = site.faq(db, 'en', { includeDrafts: true }).filter((f) => f.draft).length;
    return [
      { key: 'business', label: 'Facility name, address and phone', ok: !!(config.business.name && config.business.address && config.business.phone), note: config.business.phone ? '' : 'Add the front desk phone number.' },
      { key: 'brand', label: 'Logo and colors', ok: !!config.brand.logoUrl, note: config.brand.logoUrl ? '' : 'Upload your logo.' },
      { key: 'waiver', label: 'Your attorney-approved waiver', ok: !guests.waiverText().isSample, note: 'Replace the sample text under Settings.' },
      { key: 'prices', label: 'Prices reviewed', ok: has('price_overrides'), note: 'Confirm package and add-on prices on the Pricing tab.' },
      { key: 'stripe', label: 'Card payments (Stripe)', ok: stripe.enabled(), note: 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.' },
      { key: 'email', label: 'Emails (Resend)', ok: notifier.enabled, note: 'Set RESEND_API_KEY and verify your sending domain.' },
      { key: 'sms', label: 'Text messages (Twilio)', ok: notifier.smsEnabled, note: 'Set the Twilio keys and finish A2P registration.' },
      { key: 'assistant', label: 'Chat assistant', ok: assistant.enabled(), note: 'Set ANTHROPIC_API_KEY.' },
      { key: 'quickbooks', label: 'QuickBooks', ok: qbo.connected(), note: 'Connect from Settings.' },
      { key: 'photos', label: 'Real photos of the facility', ok: c.photos.length > 0, note: 'Upload photos on the Website tab (renderings show until then).' },
      { key: 'faq', label: 'FAQ answers', ok: drafts === 0, note: drafts ? `${drafts} question${drafts > 1 ? 's need' : ' needs'} your answer on the Website tab.` : '' },
      { key: 'goodToKnow', label: '"Before you come" tips', ok: !!c.goodToKnow, note: 'On the Website tab, add parking, what to bring and food rules for the party page.' },
      { key: 'reviews', label: 'Google review link', ok: !!config.reviews.googleReviewUrl, note: 'Add your Google "write a review" link in src/config.js (reviews.googleReviewUrl).' },
    ];
  }

  /** Quote, plus what a gift card would cover today. Throws for an unknown code. */
  function quoteWithCode(input) {
    const q = svc.quoteFor(input);
    q.dueTodayCents = q.depositCents;
    if (input.code && !q.referral) {
      const g = gifts.preview(input.code, q.depositCents);
      if (!g) throw new BookingError("We couldn't find that code. Check the spelling, or leave it blank.");
      q.gift = g;
      q.dueTodayCents = q.depositCents - g.applyCents;
    }
    return q;
  }

  /** Take the deposit for a brand-new booking, using a gift card first if one was entered. */
  async function checkoutForNewBooking(b, code, baseUrl) {
    const kind = b.quote.payInFull ? 'full' : 'deposit';
    let giftCents = 0;
    if (code && !b.referred_by) {
      const g = gifts.preview(code, b.deposit_cents);
      if (g) {
        gifts.hold(g.code, b.id, g.applyCents);
        giftCents = g.applyCents;
      }
    }
    if (giftCents >= b.deposit_cents) {
      gifts.commitHeld(b.id, { split: false });
      return `${customerUrl(b, baseUrl)}&paid=1`;
    }
    return startCheckout(b, b.deposit_cents - giftCents, kind, baseUrl);
  }

  async function startGiftCheckout(card, baseUrl) {
    if (!stripe.enabled()) return `${baseUrl}/pay/demo-gift?code=${encodeURIComponent(card.code)}`;
    const session = await stripe.createCheckout({
      amountCents: card.initial_cents,
      currency: config.payments.currency,
      productName: `${config.business.name} gift card`,
      description: `Gift card for ${card.recipient_name}`,
      email: card.buyer_email,
      bookingRef: `gift-${card.id}`,
      kind: 'gift_card',
      successUrl: `${baseUrl}/gift-cards?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/gift-cards?cancelled=1`,
    });
    db.prepare('INSERT INTO gift_sessions (session_id, gift_card_id) VALUES (?, ?)').run(session.id, card.id);
    return session.url;
  }

  function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
  }

  /** "Add to calendar" for the family's own party: a .ics file for Apple/Outlook and a Google Calendar link. */
  const icsLocal = (date, min) => `${date.replace(/-/g, '')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
  const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const partyTitle = (b) => `${b.child_name ? `${b.child_name}'s party` : 'Birthday party'} at ${config.business.shortName || config.business.name}`;
  const partyNotes = (b) => `Booking ${b.ref}. Please arrive 10-15 minutes early.\nYour party page: ${(process.env.BASE_URL || opts.baseUrl || '').replace(/\/$/, '')}/booking/${b.ref}?t=${b.token}`;
  function calendarLinks(b) {
    const g = new URLSearchParams({ action: 'TEMPLATE', text: partyTitle(b), dates: `${icsLocal(b.party_date, b.start_min)}/${icsLocal(b.party_date, b.endMin)}`, ctz: config.business.timezone, location: `${b.location.name}, ${b.location.address}`, details: partyNotes(b) });
    return { icsUrl: `/booking/${b.ref}/calendar.ics?t=${b.token}`, googleUrl: `https://calendar.google.com/calendar/render?${g}` };
  }
  function bookingIcs(b) {
    const tz = config.business.timezone;
    const stamp = (opts.clock || (() => new Date()))().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NXGS//Party App//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${b.ref}-family@nxgs-party-app`, `DTSTAMP:${stamp}`, `DTSTART;TZID=${tz}:${icsLocal(b.party_date, b.start_min)}`, `DTEND;TZID=${tz}:${icsLocal(b.party_date, b.endMin)}`,
      `SUMMARY:${icsText(partyTitle(b))}`, `LOCATION:${icsText(`${b.location.name}, ${b.location.address}`)}`, `DESCRIPTION:${icsText(partyNotes(b))}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Your party is tomorrow', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }

  /** What the customer's own booking page shows. */
  function customerView(b, lang) {
    const L = i18n.lang(lang || b.lang);
    const g = guests.partyGuests(b.id);
    const review = reviews.forBooking(b.id);
    const st = svc.detailsStatus(b);
    const active = ['confirmed', 'paid'].includes(b.status);
    return {
      lang: L,
      ref: b.ref, status: b.status, partyDate: b.party_date, timeLabel: b.timeLabel, endLabel: b.endLabel, schedule: b.schedule.map((s) => ({ ...s, label: i18n.phaseLabel(s.label, L) })),
      packageId: b.package_id, packageName: i18n.packageText({ id: b.package_id, name: b.packageName }, L).name, kids: b.kids, childName: b.child_name, childAge: b.child_age, location: b.location,
      parentFirstName: String(b.parent_name || '').split(' ')[0], email: b.email,
      theme: b.theme, themeInfo: b.themeInfo ? { ...b.themeInfo, name: i18n.themeName(b.themeInfo, L) } : null, details: b.details,
      detailsStatus: { ...st, missing: st.missing.map((m) => i18n.missingText(m, L)) },
      quote: { lines: b.quote.lines.map(({ costCents, vendor, ...l }) => ({ ...l, name: i18n.lineName(l, L) })), subtotalCents: b.quote.subtotalCents, taxCents: b.quote.taxCents },
      videoUrl: b.video_url || null,
      changes: active ? { reschedule: svc.canReschedule(b), cancel: svc.cancelTerms(b), policy: config.changes } : null,
      refundDueCents: b.refund_due_cents || 0,
      checkinPass: active && b.child_name ? checkin.passForBooking(b.id) : null,
      totalCents: b.total_cents, paidCents: b.paid_cents, balanceCents: b.balanceCents, balanceDueDate: b.balance_due_date,
      payments: svc.payments(b.id).map((x) => ({ date: x.created_at.slice(0, 10), kind: x.kind, method: x.method, amountCents: x.amount_cents })),
      locationId: b.location_id,
      inviteToken: ['confirmed', 'paid'].includes(b.status) ? b.invite_token : null,
      referralCode: ['confirmed', 'paid'].includes(b.status) ? b.referral_code : null,
      accessCode: ['confirmed', 'paid'].includes(b.status) ? b.access_code : null,
      goodToKnow: active ? String(site.content(db).goodToKnow || '').split('\n').filter(Boolean) : [],
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.location.name}, ${b.location.address}`)}`,
      calendar: active ? calendarLinks(b) : null,
      guests: g,
      canReview: reviews.canReview(b), review: review ? { rating: review.rating, comment: review.comment } : null,
      stripe: stripe.enabled(),
    };
  }

  /** Everything staff need on the day: one entry per party, in time order. */
  function runSheet(date, locationId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError('Choose a date.');
    const loc = svc.location(locationId);
    const parties = svc.list({ from: date, to: date, locationId: loc.id }).filter((b) => ['confirmed', 'paid', 'pending'].includes(b.status)).map((b) => {
      const g = guests.partyGuests(b.id);
      const st = svc.detailsStatus(b);
      return {
        id: b.id, ref: b.ref, status: b.status, timeLabel: b.timeLabel, endLabel: b.endLabel, schedule: b.schedule,
        child: b.child_name, age: b.child_age, parent: b.parent_name, phone: b.phone, host: b.host_name,
        theme: b.themeInfo, packageName: b.packageName, kids: b.kids, balanceCents: b.balanceCents,
        addOns: b.quote.lines.filter((l) => l.kind === 'addon').map((l) => ({ name: l.name, qty: l.qty, vendor: l.vendor })),
        details: b.details, missingDetails: st.missing, notes: b.notes,
        guests: g, arrived: ['confirmed', 'paid'].includes(b.status) ? checkin.roster(b.id).arrived : 0,
      };
    });
    const deliveries = {};
    for (const p of parties) for (const a of p.addOns) {
      if (!a.vendor || a.vendor === 'NXGS') continue;
      (deliveries[a.vendor] ||= []).push(`${a.name} × ${a.qty} for ${p.child || p.parent} (${p.timeLabel})`);
    }
    const blocks = db.prepare('SELECT start_min, end_min, reason FROM blocks WHERE block_date = ? AND location_id = ?').all(date, loc.id);
    return { date, location: loc, parties, deliveries, closures: blocks.map((k) => k.reason || 'Closed') };
  }
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
    const gift = db.prepare('SELECT * FROM gift_sessions WHERE session_id = ?').get(session.id);
    if (gift) return gifts.activate(gift.gift_card_id);
    const row = db.prepare('SELECT * FROM checkout_sessions WHERE session_id = ?').get(session.id);
    if (!row) return null;
    if (db.prepare('SELECT 1 FROM payments WHERE stripe_session_id = ?').get(session.id)) return svc.get(row.booking_id);
    gifts.commitHeld(row.booking_id); // a gift card used alongside this card payment
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

  // ---------- Demo payments (used until Stripe is connected) ----------
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
    if (b.status === 'pending' || b.status === 'expired') gifts.commitHeld(b.id);
    svc.recordPayment(b.id, { kind: String(query.kind), method: 'demo', amountCents: Number(query.amount), stripeSessionId: `demo_${crypto.randomUUID()}` });
    return { redirect: `${customerUrl(b, baseUrl)}&paid=1` };
  }

  function demoGiftPage({ query }) {
    if (stripe.enabled()) throw notFound();
    const card = gifts.find(query.code);
    if (!card || card.status !== 'pending') throw notFound();
    return html(layout('Demo payment', `
      <div class="card">
        <p class="banner">DEMO MODE — Stripe is not connected yet, so no real card is charged.</p>
        <h1>Pay ${money(card.initial_cents)}</h1>
        <p>Gift card for ${esc(card.recipient_name)}</p>
        <form method="post" action="/pay/demo-gift?code=${esc(card.code)}"><button class="btn">Simulate successful payment</button></form>
      </div>`));
  }

  function demoGiftSubmit({ query, baseUrl }) {
    if (stripe.enabled()) throw notFound();
    const card = gifts.find(query.code);
    if (!card || card.status !== 'pending') throw notFound();
    gifts.activate(card.id);
    return { redirect: `${baseUrl}/gift-cards?code=${encodeURIComponent(card.code)}` };
  }

  function scanPage(code) {
    let r;
    try { r = checkin.scan(code); } catch (e) {
      return html(layout('Check-in', `<div class="card" style="border:3px solid var(--bad)"><h1 style="color:var(--bad)">Not checked in</h1><p>${esc(e.message)}</p><p><a class="btn ghost" href="/admin/checkin">Open check-in</a></p></div>`));
    }
    const p = r.person || {};
    const ok = p.waiver;
    return html(layout('Checked in', `<div class="card" style="border:3px solid ${ok ? 'var(--ok)' : 'var(--warn)'}">
      <p class="eyebrow">${esc(r.roster.booking.child ? `${r.roster.booking.child}'s party` : 'Party')} · ${esc(r.roster.booking.timeLabel)}</p>
      <h1 style="margin:4px 0;color:${ok ? 'var(--ok)' : 'var(--warn)'}">✓ ${esc(r.name)} is checked in</h1>
      ${r.wrongDay ? `<p class="banner">Heads up: this party is on ${esc(fmtDate(r.wrongDay))}, not today.</p>` : ''}
      <p style="font-size:1.2rem">${ok ? '✅ Waiver on file' : '⚠️ <b>No waiver yet.</b> Have a parent sign at the desk before they play.'}</p>
      ${p.allergies ? `<p class="error" style="font-size:1.1rem">Allergies: ${esc(p.allergies)}</p>` : ''}
      <p>${r.roster.arrived} of ${r.roster.expected} expected guests are here.</p>
      <div class="actions"><a class="btn" href="/admin/checkin?party=${r.roster.booking.id}">Open guest list</a>${ok ? '' : ` <a class="btn ghost" href="/waiver?party=${esc(r.roster.booking.inviteToken)}&child=${encodeURIComponent(r.name)}">Sign waiver now</a>`}</div></div>`));
  }

  function unsubscribePage(q, confirm) {
    const email = String(q.e || '').toLowerCase();
    if (!email || !audience.validKey(email, q.k)) return html(layout('Unsubscribe', '<div class="card"><h1>Link not valid</h1><p>Please use the link from the email, or reply to the email and we\'ll take you off the list.</p></div>'));
    if (confirm) {
      audience.unsubscribe(email);
      return html(layout('Unsubscribed', `<div class="card"><h1>You're unsubscribed</h1><p>${esc(email)} won't get offers from ${esc(config.business.name)} anymore. Emails about a party you booked still come through.</p><p class="muted">Ya no recibirá ofertas. Los correos de una fiesta que reservó seguirán llegando.</p></div>`));
    }
    return html(layout('Unsubscribe', `<div class="card"><h1>Unsubscribe?</h1><p>Stop sending offers to <b>${esc(email)}</b>.</p>
      <form method="post" action="/unsubscribe?e=${encodeURIComponent(email)}&k=${encodeURIComponent(q.k)}"><button class="btn">Unsubscribe · Cancelar suscripción</button></form></div>`));
  }

  /** Serve a page with a value filled in (so it works the same in the clickable preview). */
  function sendPage(res, file, values) {
    let page = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    for (const [k, v] of Object.entries(values)) page = page.split(`__${k}__`).join(JSON.stringify(String(v)).slice(1, -1).replace(/</g, '\\u003c'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
    res.end(page);
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

      if (pathname === '/api/chat') {
        const allowed = (process.env.EMBED_ORIGINS || '*').split(/[\s,]+/).filter(Boolean);
        const origin = req.headers.origin;
        if (origin && (allowed.includes('*') || allowed.includes(origin))) {
          res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
          return res.end();
        }
      }

      // Pages
      if (req.method === 'GET' && (pathname === '/' || pathname === '/home')) return sendFile(res, 'home.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/book') return sendFile(res, 'book.html', { embeddable: true });
      if (req.method === 'GET' && (pathname === '/my-party' || pathname === '/portal')) return sendFile(res, 'portal.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/calendar') return sendFile(res, 'calendar.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/chat') return sendFile(res, 'chat.html', { embeddable: true });
      const fam = /^\/booking\/([A-Z0-9-]+)\/calendar\.ics$/.exec(pathname);
      if (req.method === 'GET' && fam) {
        const b = svc.get(authorizedBooking(fam[1], url.searchParams.get('t')).id);
        if (!['confirmed', 'paid'].includes(b.status)) return send(res, { error: 'Not found' }, 404);
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="party-${b.ref}.ics"`, 'Cache-Control': 'no-store' });
        return res.end(bookingIcs(b));
      }
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
      const bm = /^\/booking\/([A-Z0-9-]+)$/.exec(pathname);
      if (req.method === 'GET' && bm) return sendPage(res, 'booking.html', { BOOKING_REF: bm[1] });
      const im = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (req.method === 'GET' && im) return sendPage(res, 'invite.html', { INVITE_TOKEN: im[1] });
      if (req.method === 'GET' && pathname === '/waiver') return sendFile(res, 'waiver.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/gift-cards') return sendFile(res, 'gift.html', { embeddable: true });
      if (req.method === 'GET' && pathname === '/partners') return sendFile(res, 'partners.html', { embeddable: true });
      const sp = /^\/s\/(\d+)$/.exec(pathname);
      if (req.method === 'GET' && sp) {
        const to = sponsors.click(Number(sp[1]));
        return to ? send(res, { redirect: to }) : send(res, { error: 'Not found' }, 404);
      }
      if (req.method === 'GET' && pathname === '/admin/runsheet') {
        if (!adminOk(req)) return askForLogin(res);
        return sendFile(res, 'runsheet.html');
      }
      if (req.method === 'GET' && (pathname === '/admin/checkin' || pathname === '/admin/timer')) {
        if (!adminOk(req)) return askForLogin(res);
        return sendFile(res, pathname === '/admin/checkin' ? 'checkin.html' : 'timer.html');
      }
      // Scanning a guest's check-in pass with a phone camera lands here (staff must be logged in).
      const cm = /^\/c\/([rb]\d+\.[a-f0-9]+)$/.exec(pathname);
      if (req.method === 'GET' && cm) {
        if (!adminOk(req)) return askForLogin(res);
        return send(res, scanPage(cm[1]));
      }
      // Search-friendly birthday party pages, sitemap and robots.txt
      if (req.method === 'GET' && (pathname === '/birthday-parties' || pathname === '/fiestas-de-cumpleanos')) {
        return send(res, html(site.landing(db, { lang: pathname === '/birthday-parties' ? 'en' : 'es', baseUrl }).html));
      }
      if (req.method === 'GET' && pathname === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(site.sitemap(baseUrl)); }
      if (req.method === 'GET' && pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(site.robots(baseUrl)); }
      if (pathname === '/unsubscribe') {
        const q = Object.fromEntries(url.searchParams);
        return send(res, unsubscribePage(q, req.method === 'POST'));
      }
      if (pathname === '/pay/demo') {
        const ctx = { query: Object.fromEntries(url.searchParams), baseUrl };
        if (req.method === 'POST') { const r = demoPaySubmit(ctx); kick(); return send(res, r); }
        return send(res, demoPayPage(ctx));
      }
      if (pathname === '/pay/demo-gift') {
        const ctx = { query: Object.fromEntries(url.searchParams), baseUrl };
        if (req.method === 'POST') { const r = demoGiftSubmit(ctx); kick(); return send(res, r); }
        return send(res, demoGiftPage(ctx));
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
      const media = /^\/media\/([a-f0-9]+)\.(?:jpg|png|webp)$/.exec(pathname);
      if (req.method === 'GET' && media) {
        const row = db.prepare('SELECT content_type, bytes FROM media WHERE id = ?').get(media[1]);
        if (!row) return send(res, { error: 'Not found' }, 404);
        res.writeHead(200, { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable' });
        return res.end(Buffer.from(row.bytes));
      }

      // API
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (r.admin && !adminOk(req)) return send(res, { error: 'Admin login required' }, 401);
        const big = /\/(photo|details|logo)$/.test(pathname) || pathname === '/api/waivers' || pathname === '/api/admin/waiver-text';
        const rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req, big ? 3_500_000 : 100_000) : '';
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
      const end = b.endMin;
      const title = `${b.status === 'pending' ? '[HOLD] ' : ''}${config.locations.length > 1 ? `[${b.location.shortName}] ` : ''}${b.child_name ? `${b.child_name}'s party` : `${b.parent_name} party`} · ${b.kids} kids`;
      const desc = [`${b.packageName} · Booking ${b.ref}`, `Parent: ${b.parent_name} · ${b.phone} · ${b.email}`,
        b.schedule.map((s) => `${s.from} ${s.label}`).join('\n'),
        b.balanceCents > 0 ? `Balance owed: ${money(b.balanceCents)}${b.balanceOverdue ? ' (OVERDUE)' : ''}` : 'Paid in full',
        b.quote.lines.filter((l) => l.kind === 'addon').map((l) => `+ ${l.name} × ${l.qty}`).join('\n'),
        b.notes ? `Notes: ${b.notes}` : ''].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:${b.ref}@nxgs-party-app`, `DTSTAMP:${stamp}`, `LOCATION:${text(`${b.location.name}, ${b.location.address}`)}`,
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

  return { handle, svc, notifier, qbo, assistant, guests, gifts, reviews, sponsors, marketplace, waitlist, audience, checkin, insights, refreshCatalog, background, icsFeed, feedToken, runSheet, launchStatus };
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

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new BookingError('Request too large.')); req.destroy(); }
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
