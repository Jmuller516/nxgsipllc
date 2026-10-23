// Website content staff manage in Admin → Website (real photos, video tour, FAQ, Instagram posts,
// the search landing page), and the facility setup (name, brand, locations) from Admin → Setup.
// Both are saved in the settings table and laid over config.js, like prices are.

const config = require('./config');
const i18n = require('./i18n');
const { money } = require('./pricing');
const scheduling = require('./scheduling');
const { BookingError } = require('./bookings');

const clone = (x) => JSON.parse(JSON.stringify(x));
const DEFAULTS = clone({ business: config.business, brand: config.brand, emails: config.emails, assistant: config.assistant, locations: config.locations, defaultLocation: config.defaultLocation, partyHours: config.partyHours, seo: config.seo, faq: config.faq });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (v, max = 300) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

function readSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
function writeSetting(db, key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, JSON.stringify(value));
}

// ======================= Facility setup (white-label) =======================
const HEX = /^#[0-9a-f]{6}$/i;

/** Lay the saved setup over config.js. Mutates the shared config objects in place. */
function applySetup(db, cfg = config) {
  const o = readSetting(db, 'setup', {});
  Object.assign(cfg.business, clone(DEFAULTS.business), o.business || {});
  Object.assign(cfg.brand, clone(DEFAULTS.brand), o.brand || {});
  Object.assign(cfg.emails, clone(DEFAULTS.emails), o.emails || {});
  Object.assign(cfg.assistant, clone(DEFAULTS.assistant), o.assistant || {});
  cfg.partyHours = o.partyHours ? { ...o.partyHours } : clone(DEFAULTS.partyHours);
  const locs = clone(DEFAULTS.locations);
  for (const l of o.locations || []) {
    const i = locs.findIndex((x) => x.id === l.id);
    if (i >= 0) locs[i] = { ...locs[i], ...l }; else locs.push(l);
  }
  cfg.locations.splice(0, cfg.locations.length, ...locs);
  cfg.defaultLocation = locs.some((l) => l.id === o.defaultLocation && l.public) ? o.defaultLocation : DEFAULTS.defaultLocation;
  return cfg;
}

function setupView(db, cfg = config) {
  const o = readSetting(db, 'setup', {});
  return { completed: !!o.completed, business: cfg.business, brand: cfg.brand, emails: cfg.emails, assistant: cfg.assistant, partyHours: cfg.partyHours, locations: cfg.locations, defaultLocation: cfg.defaultLocation };
}

function hoursFrom(input) {
  const out = {};
  for (let d = 0; d <= 6; d++) {
    const h = input?.[d];
    if (!h || !h.open || !h.close) { out[d] = null; continue; }
    if (!/^\d{2}:\d{2}$/.test(h.open) || !/^\d{2}:\d{2}$/.test(h.close) || scheduling.toMinutes(h.close) <= scheduling.toMinutes(h.open)) throw new BookingError('Party hours: closing time must be after opening time.');
    out[d] = { open: h.open, close: h.close };
  }
  return out;
}

/** Save one step of the setup wizard. */
function saveSetup(db, input, cfg = config) {
  const o = readSetting(db, 'setup', {});
  if (input.business) {
    const b = input.business;
    if (!text(b.name)) throw new BookingError('Enter the facility name.');
    o.business = { ...(o.business || {}), name: text(b.name, 120), shortName: text(b.shortName, 40) || text(b.name, 40), website: text(b.website, 200), email: text(b.email, 200),
      phone: text(b.phone, 40) || null, address: text(b.address, 200), tagline: text(b.tagline, 200), timezone: cfg.business.timezone };
  }
  if (input.brand) {
    const b = input.brand;
    if (b.primaryColor && !HEX.test(b.primaryColor)) throw new BookingError('Colors look like #0b4fd6.');
    if (b.accentColor && !HEX.test(b.accentColor)) throw new BookingError('Colors look like #ff7a1a.');
    o.brand = { ...(o.brand || {}), primaryColor: b.primaryColor || cfg.brand.primaryColor, accentColor: b.accentColor || cfg.brand.accentColor,
      googleFont: text(b.googleFont, 100) || null, fontFamily: b.googleFont ? `"${text(b.googleFont, 100).split(':')[0]}", ${DEFAULTS.brand.fontFamily}` : DEFAULTS.brand.fontFamily,
      cornerRadius: Math.max(0, Math.min(30, Number(b.cornerRadius ?? cfg.brand.cornerRadius) || 0)), logoUrl: b.logoUrl !== undefined ? (b.logoUrl || null) : cfg.brand.logoUrl };
  }
  if (input.emails) {
    const alerts = String(input.emails.staffAlerts || '').split(/[\s,;]+/).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    o.emails = { ...(o.emails || {}), from: text(input.emails.from, 200) || cfg.emails.from, replyTo: text(input.emails.replyTo, 200) || cfg.emails.replyTo, staffAlerts: alerts.length ? alerts : cfg.emails.staffAlerts };
  }
  if (input.assistant) o.assistant = { ...(o.assistant || {}), name: text(input.assistant.name, 40) || 'Riley' };
  if (input.partyHours) o.partyHours = hoursFrom(input.partyHours);
  if (input.locations) {
    o.locations = input.locations.map((l) => {
      const id = String(l.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!id || !text(l.name)) throw new BookingError('Each location needs a name.');
      return { id, name: text(l.name, 120), shortName: text(l.shortName, 40) || text(l.name, 40), address: text(l.address, 200), phone: text(l.phone, 40) || null,
        public: !!l.public, entity: text(l.entity, 120) || null,
        ...(l.maxConcurrentParties ? { maxConcurrentParties: Math.max(1, Math.min(10, Number(l.maxConcurrentParties))) } : {}),
        ...(l.partyHours ? { partyHours: hoursFrom(l.partyHours) } : {}) };
    });
    if (!o.locations.some((l) => l.public)) throw new BookingError('At least one location must take bookings.');
  }
  if (input.defaultLocation) o.defaultLocation = String(input.defaultLocation);
  if (input.completed !== undefined) o.completed = !!input.completed;
  writeSetting(db, 'setup', o);
  return setupView(db, applySetup(db, cfg));
}

// ======================= Website content =======================
function content(db) {
  const c = readSetting(db, 'site_content', {});
  return { goodToKnow: c.goodToKnow || '', photos: c.photos || [], tourVideo: c.tourVideo || '', instagram: { handle: c.instagram?.handle || '', posts: c.instagram?.posts || [] }, faq: c.faq || null, seo: { ...config.seo, ...(c.seo || {}) } };
}

function saveContent(db, input) {
  const c = readSetting(db, 'site_content', {});
  if (input.tourVideo !== undefined) {
    const u = text(input.tourVideo, 400);
    if (u && !videoEmbed(u)) throw new BookingError('Paste a YouTube or Vimeo link, or a link to an .mp4 file.');
    c.tourVideo = u;
  }
  if (input.instagram) {
    const handle = text(input.instagram.handle, 40).replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
    const posts = String(input.instagram.posts || '').split(/\s+/).filter((u) => /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?/.test(u)).slice(0, 6);
    c.instagram = { handle, posts };
  }
  if (input.faq) {
    c.faq = input.faq.slice(0, 30).map((f) => ({ q: text(f.q, 200), a: text(f.a, 1500), qEs: text(f.qEs, 200), aEs: text(f.aEs, 1500), auto: f.auto || undefined, draft: !text(f.a) && !f.auto })).filter((f) => f.q);
  }
  if (input.seo) {
    c.seo = { pageTitle: text(input.seo.pageTitle, 70), headline: text(input.seo.headline, 120), intro: text(input.seo.intro, 600),
      areas: String(input.seo.areas || '').split(/\s*,\s*/).map((x) => text(x, 40)).filter(Boolean).slice(0, 20) };
  }
  if (input.goodToKnow !== undefined) c.goodToKnow = String(input.goodToKnow || '').replace(/\r/g, '').split('\n').map((l) => l.trim().slice(0, 240)).filter(Boolean).slice(0, 15).join('\n');
  if (input.photos) c.photos = input.photos.filter((p) => /^\/media\/[a-f0-9]+\.(jpg|png|webp)$/.test(p)).slice(0, 12);
  writeSetting(db, 'site_content', c);
  return content(db);
}

function addPhoto(db, path) {
  const c = readSetting(db, 'site_content', {});
  c.photos = [...(c.photos || []), path].slice(-12);
  writeSetting(db, 'site_content', c);
  return content(db);
}

/** YouTube / Vimeo / .mp4 link → how to show it, or null. */
function videoEmbed(url) {
  const u = String(url || '');
  let m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(u);
  if (m) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u);
  if (m) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if (/^https:\/\/\S+\.mp4(\?\S*)?$/i.test(u)) return { kind: 'file', src: u };
  return null;
}

// ---------- FAQ ----------
function autoAnswer(kind, cfg, l) {
  const es = l === 'es';
  const pk = cfg.packages.filter((p) => p.active !== false).map((p) => i18n.packageText(p, l));
  const len = (p) => { const m = (p.phases || cfg.party.phases).reduce((s, x) => s + x.minutes, 0); return m % 60 ? (es ? `${m} minutos` : `${m} minutes`) : (es ? `${m / 60} horas` : `${m / 60} hours`); };
  const join = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} ${es ? 'y' : 'and'} ${a.at(-1)}`);
  const pay = cfg.payments, ch = cfg.changes || {};
  if (kind === 'length') {
    const groups = {};
    for (const p of pk) (groups[len(p)] ||= []).push(p.name);
    const parts = Object.entries(groups).map(([t, names]) => es ? `${names.length > 1 ? 'Las fiestas' : 'La'} ${join(names)} ${names.length > 1 ? 'duran' : 'dura'} ${t}` : `The ${join(names)} ${names.length > 1 ? 'are' : 'is'} ${t}`);
    return `${parts.join('. ')}. ${es ? 'Todas incluyen juego en la cancha, tiempo en el salón de videojuegos y tiempo en el salón de fiestas para comida, pastel y regalos.' : 'Every party includes field play, time in the video game room, and time in the party room for food, cake and presents.'}`;
  }
  if (kind === 'kids') {
    const inc = Math.min(...pk.map((p) => p.includedKids)), extra = Math.min(...pk.map((p) => p.extraKidCents));
    return es ? `Cada paquete incluye ${inc} niños, y puede agregar más por ${money(extra)} por niño, hasta ${cfg.party.maxKids} niños.`
      : `Each package includes ${inc} kids, and you can add more for ${money(extra)} per child, up to ${cfg.party.maxKids} kids.`;
  }
  if (kind === 'payments') {
    return es ? `Un depósito no reembolsable del ${pay.depositPercent}% reserva su fiesta. El resto se paga ${pay.balanceDueDaysBefore} días antes de la fiesta. Las fiestas reservadas con menos de ${pay.balanceDueDaysBefore} días se pagan completas.`
      : `A ${pay.depositPercent}% non-refundable deposit reserves your party. The rest is due ${pay.balanceDueDaysBefore} days before the party. Parties booked less than ${pay.balanceDueDaysBefore} days ahead are paid in full.`;
  }
  if (kind === 'changes') {
    const times = ch.freeReschedules === 1 ? (es ? 'una vez' : 'once') : (es ? `${ch.freeReschedules} veces` : `${ch.freeReschedules} times`);
    return es ? `Puede cambiar la fecha ${times} desde su página de reserva hasta ${ch.rescheduleMinDays} días antes de la fiesta, si el nuevo horario está libre. Si cancela con al menos ${ch.cancelRefundMinDays} días de anticipación, le devolvemos todo menos el depósito; después de eso, los pagos no son reembolsables.`
      : `You can move your party ${times} from your booking page up to ${ch.rescheduleMinDays} days before the party, if the new time is open. If you cancel at least ${ch.cancelRefundMinDays} days before, we refund everything except the deposit; after that, payments aren't refunded.`;
  }
  return '';
}

/** FAQ in a language. Staff edits win; draft questions (no answer yet) are hidden from customers. */
function faq(db, l = 'en', { includeDrafts = false, cfg = config } = {}) {
  const list = content(db).faq || cfg.faq;
  return list.map((f) => {
    const a = f.auto ? autoAnswer(f.auto, cfg, l) : l === 'es' ? (f.aEs || i18n.faqAnswer(f.q, f.a, 'es')) : f.a;
    return { q: l === 'es' ? (f.qEs || i18n.faqQuestion(f.q, 'es')) : f.q, a, auto: f.auto || null, draft: !a, en: { q: f.q, a: f.a }, es: { q: f.qEs || '', a: f.aEs || '' } };
  }).filter((f) => includeDrafts || !f.draft);
}

/** What the public pages need. */
function publicSite(db, l = 'en') {
  const c = content(db);
  return { photos: c.photos, tourVideo: c.tourVideo ? { url: c.tourVideo, ...videoEmbed(c.tourVideo) } : null, instagram: c.instagram, faq: faq(db, l).map(({ q, a }) => ({ q, a })) };
}

// ======================= Search landing page =======================
function parseAddress(a) {
  const m = /^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})/.exec(String(a || ''));
  return m ? { '@type': 'PostalAddress', streetAddress: m[1], addressLocality: m[2], addressRegion: m[3], postalCode: m[4], addressCountry: 'US' } : { '@type': 'PostalAddress', streetAddress: a };
}

function landing(db, { lang = 'en', baseUrl, cfg = config }) {
  const l = i18n.lang(lang), es = l === 'es';
  const c = content(db);
  const loc = cfg.locations.find((x) => x.id === cfg.defaultLocation) || cfg.locations[0];
  const pk = cfg.packages.filter((p) => p.active !== false).map((p) => i18n.packageText(p, l));
  const qs = faq(db, l);
  const path = es ? '/fiestas-de-cumpleanos' : '/birthday-parties';
  const other = es ? '/birthday-parties' : '/fiestas-de-cumpleanos';
  const seo = c.seo;
  const title = es ? `Fiestas de cumpleaños infantiles en ${loc.shortName}, NY | ${cfg.business.shortName}` : `${seo.pageTitle} | ${cfg.business.shortName}`;
  const headline = es ? `Fiestas de cumpleaños deportivas en ${loc.shortName}` : seo.headline;
  const intro = es ? 'Juegos en la cancha de césped, un salón de videojuegos y un salón de fiestas privado, con un anfitrión que lo organiza todo. Elija su paquete y reserve en línea en minutos.' : seo.intro;
  const desc = `${headline}. ${pk.map((p) => `${p.name} ${money(p.priceCents)}`).join(' · ')}. ${es ? 'Reserve en línea.' : 'Book online.'}`.slice(0, 300);
  const photos = c.photos.length ? c.photos : ['/static/img/exterior-front.jpg', '/static/img/field.jpg', '/static/img/front-desk.jpg', '/static/img/courts.jpg', '/static/img/gameroom.jpg', '/static/img/lounge.jpg'];
  const abs = (p) => (/^https?:/.test(p) ? p : `${baseUrl}${p}`);
  const book = `${baseUrl}/book${es ? '?lang=es' : ''}`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'SportsActivityLocation', name: loc.name || cfg.business.name, url: cfg.business.website || baseUrl,
    address: parseAddress(loc.address), ...(loc.phone || cfg.business.phone ? { telephone: loc.phone || cfg.business.phone } : {}),
    image: photos.map(abs), areaServed: seo.areas.map((a) => ({ '@type': 'City', name: `${a}, NY` })),
    priceRange: `${money(Math.min(...pk.map((p) => p.priceCents)))}–${money(Math.max(...pk.map((p) => p.priceCents)))}`,
    makesOffer: pk.map((p) => ({ '@type': 'Offer', name: p.name, description: p.description, price: (p.priceCents / 100).toFixed(2), priceCurrency: 'USD', url: book })),
  }];
  if (qs.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  const ldTag = ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n');
  const body = `
  <header class="seo-hero"><img src="${esc(photos[0])}" alt="${esc(es ? 'Next Generation Sports Complex' : `${loc.name} sports complex`)}" width="1280" height="720">
    <div><p class="eyebrow">${esc(cfg.business.name)} · ${esc(loc.shortName)}, NY</p><h1>${esc(headline)}</h1><p>${esc(intro)}</p>
    <p><a class="btn" href="${esc(book)}">${es ? 'Ver fechas y reservar' : 'See dates & book'}</a> <a class="btn ghost" href="${baseUrl}/calendar${es ? '?lang=es' : ''}">${es ? 'Calendario de disponibilidad' : 'Availability calendar'}</a></p></div></header>
  <section><h2>${es ? 'Paquetes de fiesta' : 'Party packages'}</h2><div class="seo-grid">
    ${pk.map((p) => `<article class="card"><h3>${esc(p.name)}</h3><p class="price">${money(p.priceCents)}</p><p class="muted">${es ? `Incluye ${p.includedKids} niños` : `Includes ${p.includedKids} kids`}</p><ul>${String(p.includes || '').split('\n').filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}
  </div></section>
  <section><h2>${es ? 'Cómo funciona' : 'How it works'}</h2><ol>
    <li>${es ? 'Elija un paquete y una hora libre en línea.' : 'Pick a package and an open time online.'}</li>
    <li>${es ? `Reserve con un depósito del ${cfg.payments.depositPercent}%.` : `Reserve with a ${cfg.payments.depositPercent}% deposit.`}</li>
    <li>${es ? 'Envíe el enlace de invitación: los invitados confirman y firman la exención en línea.' : 'Send your invitation link: guests RSVP and sign the waiver online.'}</li>
    <li>${es ? 'Llegue y disfrute. Nuestro equipo se encarga del resto.' : 'Show up and enjoy. Our team handles the rest.'}</li></ol></section>
  ${qs.length ? `<section><h2>${es ? 'Preguntas frecuentes' : 'Questions parents ask'}</h2>${qs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>` : ''}
  <section><h2>${es ? 'Dónde estamos' : 'Where we are'}</h2><p><b>${esc(loc.name)}</b><br>${esc(loc.address)}${loc.phone ? `<br>${esc(loc.phone)}` : ''}</p>
    ${seo.areas.length ? `<p class="muted">${es ? 'Cerca de' : 'Close to families in'} ${esc(seo.areas.join(', '))}.</p>` : ''}
    <p><a class="btn" href="${esc(book)}">${es ? 'Reservar una fiesta' : 'Book a party'}</a> · <a href="${baseUrl}${other}" hreflang="${es ? 'en' : 'es'}">${es ? 'English' : 'Español'}</a></p></section>`;
  const html = `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${baseUrl}${path}"><link rel="alternate" hreflang="en" href="${baseUrl}/birthday-parties"><link rel="alternate" hreflang="es" href="${baseUrl}/fiestas-de-cumpleanos">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(abs(photos[0]))}"><meta property="og:url" content="${baseUrl}${path}">
<link rel="stylesheet" href="/static/style.css"><link rel="stylesheet" href="/static/theme.css">
<style>.seo-hero{display:grid;gap:16px;margin:0 0 20px}.seo-hero img{width:100%;height:auto;border-radius:var(--radius);aspect-ratio:16/9;object-fit:cover}.seo-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}.seo-grid .price{font-size:1.5rem;font-weight:800;margin:0}.seo-grid ul{padding-left:18px}section{margin:28px 0}details{border-bottom:1px solid var(--line);padding:10px 0}summary{font-weight:600;cursor:pointer}</style>
${ldTag}</head><body><main>${body}</main></body></html>`;
  return { html, body, jsonLd: ldTag, title, description: desc };
}

function sitemap(baseUrl) {
  const urls = ['/birthday-parties', '/fiestas-de-cumpleanos', '/book', '/calendar', '/gift-cards', '/partners'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${baseUrl}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}
function robots(baseUrl) {
  return `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /booking/\nDisallow: /invite/\nDisallow: /c/\nDisallow: /pay/\nSitemap: ${baseUrl}/sitemap.xml\n`;
}

module.exports = { applySetup, setupView, saveSetup, content, saveContent, addPhoto, videoEmbed, faq, publicSite, landing, sitemap, robots, autoAnswer };
