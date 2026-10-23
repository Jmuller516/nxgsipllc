// Automatic emails: confirmations, receipts, reminders and staff alerts.
// Every email is written to the `emails` table first (the admin "Messages" tab), then sent.
// Sending uses Resend (https://resend.com) when RESEND_API_KEY is set; otherwise emails are
// recorded as "not_configured" so you can see exactly what customers would have received.
// Customer emails go out in the family's language (English or Spanish); staff emails are in English.

const config = require('./config');
const { money, addDays } = require('./pricing');
const { todayLocal } = require('./bookings');
const i18n = require('./i18n');
const scheduling = require('./scheduling');

const MAX_ATTEMPTS = 5;

function hourLocal(now, tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

const fmtDate = (ymd) => i18n.fmtDate(ymd, 'en');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- customer wording, per language ----------
const WORDS = {
  en: {
    date: 'Date', time: 'Time', pkg: 'Package', ref: 'Booking #', kids: 'kids', total: 'Total', paidSoFar: 'Paid so far', balance: 'Balance', paid: 'Paid',
    who: (b) => (b.child_name ? `${b.child_name}'s party` : 'your party'),
    footer: 'Reply to this email with any questions.',
    viewBooking: 'View my booking',
    codeBox: (code, url) => `<b>Your party page code: <span style="font-size:18px;letter-spacing:.08em">${code}</span></b><br>Keep this email. You can always open your party page at <a href="${url}">${url}</a> with your email and this code. It shows everything you're getting and what's left to do.`,
    codeText: (code, url) => `Your party page code: ${code}. Open your party page anytime at ${url} with your email and this code.`,
    codeSubject: 'Your NXGS party page code',
    codeHeading: 'Your party page code',
    codeBody: (name) => `Hi ${name}, here is the code for your party page. Enter it with the email you booked with.`,
    weekSubject: (who) => `One week to go: ${who}`,
    weekHeading: 'One week to go!',
    weekBody: (b, who) => `Hi ${b.parent_name}, ${who} is one week away. Here is what is left so everything is ready:`,
    weekAllSet: 'Nothing left to do. We can’t wait to see you!',
    weekBalance: (amt, d) => `Pay the ${amt} balance (due ${d})`,
    weekDetails: (list) => `Finish your party details: ${list}`,
    weekInvite: 'Send the invitation link to your guests',
    weekWaivers: (n) => `${n} waiver(s) still unsigned`,
    weekButton: 'Open my party page',
    weekSms: (who, n, link) => `${who} is one week away! ${n ? `${n} thing(s) left to do` : 'You are all set'}: ${link}`,
    rebookSubject: 'Thank you from NXGS, plus a gift for your next party',
    rebookHeading: 'Thank you for celebrating with us!',
    rebookBody: (b, amt) => `Hi ${b.parent_name}, it was a pleasure hosting ${b.child_name || 'your family'}. Here is ${amt} in party credit toward your next party or add-ons. Enter this code at checkout:`,
    rebookButton: 'Book my next party',
    rebookText: (amt, code) => `Thank you for celebrating with us! Here is ${amt} in party credit toward your next party: ${code}`,
    confirmedSubject: (b, d) => `Party confirmed — ${d} at ${b.timeLabel} (${b.ref})`,
    confirmedHeading: (b, who) => (b.status === 'paid' ? `You're booked! ${who} is paid in full` : `You're booked! Deposit received for ${who}`),
    hiThanks: (b, biz) => `Hi ${b.parent_name}, thanks for booking with ${biz}!`,
    balanceDueBy: (amt, d) => `The remaining <b>${amt}</b> is due by <b>${d}</b>. You can pay it anytime from your booking page.`,
    nextSteps: 'Next steps',
    nextStepsNote: 'all on your booking page',
    stepDetails: (shirts) => `Fill in your party details (theme, name spelling, allergies${shirts ? ', shirt sizes' : ''}).`,
    stepInvite: 'Send your invitation link to guests:',
    stepInviteAfter: 'Guests RSVP and sign the waiver online.',
    referralBox: (code, off, credit) => `Know another family planning a party? Share your code <b>${code}</b>: they get ${off} off and you get ${credit} in party credit.`,
    depositNote: (pct) => `The ${pct}% deposit is non-refundable.`,
    confirmedText: (b, biz) => `Hi ${b.parent_name}, thanks for booking with ${biz}!`,
    paymentSubject: (amt, ref) => `Payment received — ${amt} (${ref})`,
    paymentHeading: (full) => (full ? "Thanks — you're paid in full!" : 'Payment received'),
    paymentBody: (b, amt, who) => `Hi ${b.parent_name}, we received <b>${amt}</b> for ${who}.`,
    viewReceipt: 'View my receipt',
    reminderSubject: (d, ref) => `Balance due ${d} — ${ref}`,
    reminderHeading: 'Your balance is due soon',
    reminderBody: (b, amt, who, d) => `Hi ${b.parent_name}, just a reminder that the remaining <b>${amt}</b> for ${who} is due by <b>${d}</b>.`,
    pay: (amt) => `Pay ${amt}`,
    overdueSubject: (ref) => `Balance past due — ${ref}`,
    overdueHeading: 'Your balance is past due',
    overdueBody: (b, amt, who, d) => `Hi ${b.parent_name}, the remaining <b>${amt}</b> for ${who} was due ${d}. Please pay it before the party, or reply and let us know if you have questions.`,
    detailsSubject: (who) => `A few details needed for ${who}`,
    detailsHeading: 'Help us get everything ready',
    detailsBody: (b, who, d) => `Hi ${b.parent_name}, we still need a few things for ${who} on ${d}:`,
    detailsAfter: 'It only takes a minute.',
    addDetails: 'Add party details',
    tomorrowSubject: (b, biz) => `See you tomorrow at ${b.timeLabel}! — ${biz}`,
    tomorrowHeading: 'See you tomorrow!',
    tomorrowBody: (b, who) => `Hi ${b.parent_name}, we're getting ready for ${who}. Please arrive about 10–15 minutes early.`,
    schedule: 'Schedule', balanceRemaining: (amt) => `Balance remaining: <b>${amt}</b>.`,
    guestsLine: (g) => `<b>Guests:</b> ${g.yes} coming. <b>Waivers:</b> ${g.waiversSigned} of ${g.waiversNeeded} signed.`,
    waiversNeeded: (names) => `Still needed for: ${names}. Guests can sign at your invitation link`,
    orFrontDesk: '(or at the front desk)',
    reviewSubject: (who) => `How was ${who}?`,
    reviewHeading: 'Thanks for celebrating with us!',
    reviewBody: (b) => `Hi ${b.parent_name}, we hope ${b.child_name || 'everyone'} had a blast. Would you take 30 seconds to tell us how it went?`,
    reviewButton: 'Leave a quick review',
    movedSubject: (d, t, ref) => `Party moved to ${d} at ${t} (${ref})`,
    movedHeading: 'Your party has a new date',
    movedBody: (b, from) => `Hi ${b.parent_name}, your party was moved from ${from}. Here are the new details:`,
    movedCredit: (amt) => `The new price is lower than what you've paid, so we added <b>${amt}</b> in party credit. Your code is below and on your booking page.`,
    movedMore: (amt, d) => `The new total is a bit higher. The remaining <b>${amt}</b> is due by <b>${d}</b>.`,
    cancelledSubject: (ref) => `Your party is cancelled (${ref})`,
    cancelledHeading: 'Your party is cancelled',
    cancelledBody: (b, who, d) => `Hi ${b.parent_name}, we've cancelled ${who} on ${d}. We're sorry you can't make it.`,
    refundLine: (amt) => `We're refunding <b>${amt}</b>. Card refunds usually show up in 5–10 business days.`,
    noRefundLine: (pct, days) => `The ${pct}% deposit is non-refundable, and parties cancelled less than ${days} days before aren't refunded.`,
    comeBack: "We'd love to celebrate with you another time.",
    bookAgain: 'Book another date',
    videoSubject: (who) => `Your highlight video from ${who} is ready!`,
    videoHeading: 'Your highlight video is ready',
    videoBody: (b, who) => `Hi ${b.parent_name}, here's the highlight video from ${who}. Share it with your guests!`,
    watchVideo: 'Watch the video',
    waitSubject: (d) => `A party time just opened on ${d}`,
    waitHeading: 'Good news: a time opened up!',
    waitBody: (w, d) => `Hi ${w.parent_name}, a party time just opened on <b>${d}</b>, the day you asked about. Times go fast, so book soon. Whoever books first gets it.`,
    waitButton: 'See open times',
    recoverySubject: (d) => `Your party time on ${d} is still open`,
    recoverySubjectGone: (d) => `Still planning a party for ${d}?`,
    recoveryHeading: 'Still planning your party?',
    recoveryBody: (b, d, t) => `Hi ${b.parent_name}, your hold for ${d} at ${t} ran out before checkout finished. Good news: that time is still open.`,
    recoveryBodyGone: (b, d) => `Hi ${b.parent_name}, your hold for ${d} ran out before checkout finished, and that time has since been taken. There are other open times you can grab.`,
    recoveryButton: 'Finish booking',
    recoveryButtonGone: 'See open times',
    offerSubject: (child) => `Thanks for coming to ${child ? `${child}'s` : 'the'} party!`,
    offerHeading: 'Your turn to celebrate?',
    offerBody: (c, host, biz) => `Hi ${c.name || 'there'}, thanks for coming to ${host ? `${host}'s` : 'the'} party at ${biz}! We hope ${c.child_name || 'your child'} had a great time.`,
    offerCode: (code, off) => `Planning a party of your own? Use code <b>${code}</b> for <b>${off} off</b> when you book.`,
    offerPrograms: (txt) => `We also run ${txt} all year.`,
    offerButton: 'Book a party',
    seePrograms: 'See programs',
    unsubscribe: 'Unsubscribe',
    whyGetting: "You're getting this because you asked to hear about camps, clinics and party offers.",
  },
  es: {
    date: 'Fecha', time: 'Hora', pkg: 'Paquete', ref: 'Reserva #', kids: 'niños', total: 'Total', paidSoFar: 'Pagado hasta ahora', balance: 'Saldo', paid: 'Pagado',
    who: (b) => (b.child_name ? `la fiesta de ${b.child_name}` : 'su fiesta'),
    footer: 'Responda a este correo si tiene preguntas.',
    viewBooking: 'Ver mi reserva',
    codeBox: (code, url) => `<b>Código de su página de la fiesta: <span style="font-size:18px;letter-spacing:.08em">${code}</span></b><br>Guarde este correo. Siempre puede abrir su página en <a href="${url}">${url}</a> con su correo y este código. Muestra todo lo que incluye su fiesta y lo que falta por hacer.`,
    codeText: (code, url) => `Código de su página de la fiesta: ${code}. Ábrala en ${url} con su correo y este código.`,
    codeSubject: 'Su código para la página de la fiesta',
    codeHeading: 'Su código de la página de la fiesta',
    codeBody: (name) => `Hola ${name}, aquí está el código de la página de su fiesta. Ingréselo con el correo que usó para reservar.`,
    weekSubject: (who) => `Falta una semana: ${who}`,
    weekHeading: '¡Falta una semana!',
    weekBody: (b, who) => `Hola ${b.parent_name}, falta una semana para ${who}. Esto es lo que falta para que todo esté listo:`,
    weekAllSet: 'No falta nada por hacer. ¡Los esperamos!',
    weekBalance: (amt, d) => `Pague el saldo de ${amt} (vence el ${d})`,
    weekDetails: (list) => `Termine los datos de la fiesta: ${list}`,
    weekInvite: 'Envíe el enlace de invitación a sus invitados',
    weekWaivers: (n) => `Faltan ${n} exención(es) por firmar`,
    weekButton: 'Abrir la página de mi fiesta',
    weekSms: (who, n, link) => `¡Falta una semana para ${who}! ${n ? `Falta hacer ${n} cosa(s)` : 'Todo está listo'}: ${link}`,
    rebookSubject: 'Gracias de parte de NXGS, y un regalo para su próxima fiesta',
    rebookHeading: '¡Gracias por celebrar con nosotros!',
    rebookBody: (b, amt) => `Hola ${b.parent_name}, fue un placer recibir a ${b.child_name || 'su familia'}. Aquí tiene ${amt} de crédito para su próxima fiesta o extras. Ingrese este código al pagar:`,
    rebookButton: 'Reservar mi próxima fiesta',
    rebookText: (amt, code) => `¡Gracias por celebrar con nosotros! Aquí tiene ${amt} de crédito para su próxima fiesta: ${code}`,
    confirmedSubject: (b, d) => `Fiesta confirmada — ${d} a las ${b.timeLabel} (${b.ref})`,
    confirmedHeading: (b, who) => (b.status === 'paid' ? `¡Reserva lista! ${cap(who)} está pagada por completo` : `¡Reserva lista! Recibimos el depósito de ${who}`),
    hiThanks: (b, biz) => `Hola ${b.parent_name}, ¡gracias por reservar con ${biz}!`,
    balanceDueBy: (amt, d) => `El saldo de <b>${amt}</b> vence el <b>${d}</b>. Puede pagarlo cuando quiera desde su página de reserva.`,
    nextSteps: 'Próximos pasos',
    nextStepsNote: 'todo en su página de reserva',
    stepDetails: (shirts) => `Complete los detalles de la fiesta (tema, nombre exacto, alergias${shirts ? ', tallas de camisetas' : ''}).`,
    stepInvite: 'Envíe su enlace de invitación a los invitados:',
    stepInviteAfter: 'Los invitados confirman y firman la exención en línea.',
    referralBox: (code, off, credit) => `¿Conoce otra familia que esté planeando una fiesta? Comparta su código <b>${code}</b>: ellos reciben ${off} de descuento y usted recibe ${credit} en crédito para fiestas.`,
    depositNote: (pct) => `El depósito del ${pct}% no es reembolsable.`,
    confirmedText: (b, biz) => `Hola ${b.parent_name}, ¡gracias por reservar con ${biz}!`,
    paymentSubject: (amt, ref) => `Pago recibido — ${amt} (${ref})`,
    paymentHeading: (full) => (full ? '¡Gracias! Su fiesta está pagada por completo' : 'Pago recibido'),
    paymentBody: (b, amt, who) => `Hola ${b.parent_name}, recibimos <b>${amt}</b> para ${who}.`,
    viewReceipt: 'Ver mi recibo',
    reminderSubject: (d, ref) => `Saldo vence el ${d} — ${ref}`,
    reminderHeading: 'Su saldo vence pronto',
    reminderBody: (b, amt, who, d) => `Hola ${b.parent_name}, le recordamos que el saldo de <b>${amt}</b> de ${who} vence el <b>${d}</b>.`,
    pay: (amt) => `Pagar ${amt}`,
    overdueSubject: (ref) => `Saldo vencido — ${ref}`,
    overdueHeading: 'Su saldo está vencido',
    overdueBody: (b, amt, who, d) => `Hola ${b.parent_name}, el saldo de <b>${amt}</b> de ${who} venció el ${d}. Por favor páguelo antes de la fiesta, o responda si tiene preguntas.`,
    detailsSubject: (who) => `Nos faltan unos detalles para ${who}`,
    detailsHeading: 'Ayúdenos a tener todo listo',
    detailsBody: (b, who, d) => `Hola ${b.parent_name}, todavía necesitamos algunas cosas para ${who} el ${d}:`,
    detailsAfter: 'Solo toma un minuto.',
    addDetails: 'Agregar detalles',
    tomorrowSubject: (b, biz) => `¡Nos vemos mañana a las ${b.timeLabel}! — ${biz}`,
    tomorrowHeading: '¡Nos vemos mañana!',
    tomorrowBody: (b, who) => `Hola ${b.parent_name}, estamos preparando ${who}. Por favor lleguen unos 10–15 minutos antes.`,
    schedule: 'Horario', balanceRemaining: (amt) => `Saldo pendiente: <b>${amt}</b>.`,
    guestsLine: (g) => `<b>Invitados:</b> ${g.yes} vienen. <b>Exenciones:</b> ${g.waiversSigned} de ${g.waiversNeeded} firmadas.`,
    waiversNeeded: (names) => `Faltan: ${names}. Los invitados pueden firmar con su enlace de invitación`,
    orFrontDesk: '(o en la recepción)',
    reviewSubject: (who) => `¿Qué tal estuvo ${who}?`,
    reviewHeading: '¡Gracias por celebrar con nosotros!',
    reviewBody: (b) => `Hola ${b.parent_name}, esperamos que ${b.child_name || 'todos'} se hayan divertido mucho. ¿Nos cuenta en 30 segundos cómo les fue?`,
    reviewButton: 'Dejar una reseña rápida',
    movedSubject: (d, t, ref) => `Fiesta cambiada al ${d} a las ${t} (${ref})`,
    movedHeading: 'Su fiesta tiene nueva fecha',
    movedBody: (b, from) => `Hola ${b.parent_name}, su fiesta se cambió del ${from}. Estos son los nuevos detalles:`,
    movedCredit: (amt) => `El nuevo precio es menor a lo que pagó, así que le dimos <b>${amt}</b> en crédito para fiestas. Su código está abajo y en su página de reserva.`,
    movedMore: (amt, d) => `El nuevo total es un poco mayor. El saldo de <b>${amt}</b> vence el <b>${d}</b>.`,
    cancelledSubject: (ref) => `Su fiesta está cancelada (${ref})`,
    cancelledHeading: 'Su fiesta está cancelada',
    cancelledBody: (b, who, d) => `Hola ${b.parent_name}, cancelamos ${who} del ${d}. Lamentamos que no puedan venir.`,
    refundLine: (amt) => `Le reembolsaremos <b>${amt}</b>. Los reembolsos a tarjeta suelen aparecer en 5–10 días hábiles.`,
    noRefundLine: (pct, days) => `El depósito del ${pct}% no es reembolsable, y las fiestas canceladas con menos de ${days} días no tienen reembolso.`,
    comeBack: 'Nos encantaría celebrar con ustedes en otra ocasión.',
    bookAgain: 'Reservar otra fecha',
    videoSubject: (who) => `¡Ya está listo el video de ${who}!`,
    videoHeading: 'Su video de los mejores momentos está listo',
    videoBody: (b, who) => `Hola ${b.parent_name}, aquí está el video de los mejores momentos de ${who}. ¡Compártalo con sus invitados!`,
    watchVideo: 'Ver el video',
    waitSubject: (d) => `Se abrió un horario el ${d}`,
    waitHeading: '¡Buenas noticias: se abrió un horario!',
    waitBody: (w, d) => `Hola ${w.parent_name}, se acaba de abrir un horario para fiestas el <b>${d}</b>, el día que pidió. Los horarios se van rápido: el primero que reserva se lo queda.`,
    waitButton: 'Ver horarios libres',
    recoverySubject: (d) => `Su horario del ${d} sigue libre`,
    recoverySubjectGone: (d) => `¿Sigue planeando una fiesta para el ${d}?`,
    recoveryHeading: '¿Sigue planeando su fiesta?',
    recoveryBody: (b, d, t) => `Hola ${b.parent_name}, su reserva temporal del ${d} a las ${t} venció antes de terminar el pago. Buenas noticias: ese horario sigue libre.`,
    recoveryBodyGone: (b, d) => `Hola ${b.parent_name}, su reserva temporal del ${d} venció antes de terminar el pago, y ese horario ya se ocupó. Hay otros horarios libres.`,
    recoveryButton: 'Terminar la reserva',
    recoveryButtonGone: 'Ver horarios libres',
    offerSubject: (child) => `¡Gracias por venir a la fiesta${child ? ` de ${child}` : ''}!`,
    offerHeading: '¿Le toca celebrar?',
    offerBody: (c, host, biz) => `Hola ${c.name || ''}, ¡gracias por venir a la fiesta${host ? ` de ${host}` : ''} en ${biz}! Esperamos que ${c.child_name || 'su hijo'} se haya divertido.`,
    offerCode: (code, off) => `¿Planea su propia fiesta? Use el código <b>${code}</b> para <b>${off} de descuento</b> al reservar.`,
    offerPrograms: (txt) => `También tenemos ${txt === 'camps, clinics and leagues' ? 'campamentos, clínicas y ligas' : txt} todo el año.`,
    offerButton: 'Reservar una fiesta',
    seePrograms: 'Ver programas',
    unsubscribe: 'Cancelar suscripción',
    whyGetting: 'Recibe esto porque pidió información sobre campamentos, clínicas y ofertas de fiestas.',
  },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const W = (lang) => WORDS[lang === 'es' ? 'es' : 'en'];

/** Default sender: Resend's HTTP API. */
async function resendSend({ from, to, replyTo, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend error ${res.status}`);
  return data.id;
}

/** Text messages through Twilio. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID). */
async function twilioSend({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', process.env.TWILIO_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
  return data.sid;
}
const twilioReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));

/** US phone number in +1XXXXXXXXXX form, or null. */
function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

function createNotifier(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const issueCredit = opts.issueCredit || null;
  const baseUrl = () => (opts.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const sender = opts.sender || (process.env.RESEND_API_KEY ? resendSend : null);
  const smsSender = opts.smsSender || (twilioReady() ? twilioSend : null);
  const guests = opts.guests || null;
  const sponsors = opts.sponsors || null;
  const audience = opts.audience || null;
  const biz = cfg.business;

  const customerLink = (b) => `${baseUrl()}/booking/${b.ref}?t=${b.token}`;
  const portalLink = () => `${baseUrl()}/my-party`;
  const inviteLink = (b) => `${baseUrl()}/invite/${b.invite_token}`;
  const bookLink = (params) => `${baseUrl()}/book?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))}`;
  const date = (ymd, lang) => i18n.fmtDate(ymd, lang);
  const pkgName = (b) => (b.lang === 'es' ? i18n.packageText({ id: b.package_id, name: b.packageName }, 'es').name : b.packageName);

  // ---------- layout ----------
  function wrap(heading, bodyHtml, button, { lang = 'en', unsubscribe = null } = {}) {
    const c = cfg.brand.primaryColor;
    const logoSrc = cfg.brand.logoUrl ? (/^https?:/.test(cfg.brand.logoUrl) ? cfg.brand.logoUrl : `${baseUrl()}${cfg.brand.logoUrl}`) : null;
    const logo = logoSrc ? `<img src="${esc(logoSrc)}" alt="${esc(biz.name)}" style="max-height:48px;margin-bottom:12px">` : `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6676">${esc(biz.name)}</div>`;
    const btn = button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:${c};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;display:inline-block">${esc(button.label)}</a></p>` : '';
    const sp = sponsors ? sponsors.forPlacement('email', null, { count: true }) : [];
    const spLine = sp.length ? `<p style="font-size:12px;color:#5b6676;text-align:center;margin:12px 0 0">${lang === 'es' ? 'Fiestas presentadas por' : 'Parties presented by'} ${sp.map((x) => x.hasLink ? `<a href="${esc(baseUrl())}/s/${x.id}" style="color:#5b6676">${esc(x.name)}</a>` : esc(x.name)).join(' · ')}</p>` : '';
    const site = biz.website ? ` · <a href="${esc(biz.website)}" style="color:#5b6676">${esc(biz.website.replace(/^https?:\/\//, ''))}</a>` : '';
    const unsub = unsubscribe ? `<p style="font-size:12px;color:#5b6676;text-align:center;margin-top:8px">${esc(W(lang).whyGetting)} ${esc(biz.address || '')}<br><a href="${esc(unsubscribe)}" style="color:#5b6676">${esc(W(lang).unsubscribe)}</a></p>` : '';
    return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#0f1b2d">
      <div style="max-width:560px;margin:0 auto;padding:24px 16px">
        <div style="background:#fff;border:1px solid #dfe4eb;border-radius:12px;padding:24px">
          ${logo}
          <h1 style="font-size:22px;margin:8px 0 12px">${esc(heading)}</h1>
          ${bodyHtml}
          ${btn}
        </div>
        ${spLine}
        <p style="font-size:12px;color:#5b6676;text-align:center;margin-top:16px">${esc(biz.name)}${site} · ${esc(W(lang).footer)}</p>
        ${unsub}
      </div></body></html>`;
  }

  function partyFacts(b, lang = b.lang) {
    const w = W(lang);
    const rows = [
      [w.date, date(b.party_date, lang)],
      [w.time, `${b.timeLabel} – ${b.endLabel}`],
      [w.pkg, `${lang === b.lang ? pkgName(b) : b.packageName} · ${b.kids} ${w.kids}`],
      [w.ref, b.ref],
    ];
    return `<table style="border-collapse:collapse;width:100%;margin:12px 0">${rows.map(([k, v]) =>
      `<tr><td style="padding:6px 0;color:#5b6676;width:110px">${k}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`;
  }

  function moneyFacts(b, lang = b.lang) {
    const w = W(lang);
    return `<table style="border-collapse:collapse;width:100%;margin:12px 0;border-top:1px solid #dfe4eb">
      <tr><td style="padding:6px 0">${w.total}</td><td style="padding:6px 0;text-align:right">${money(b.total_cents)}</td></tr>
      <tr><td style="padding:6px 0">${w.paidSoFar}</td><td style="padding:6px 0;text-align:right">${money(b.paid_cents)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700">${w.balance}</td><td style="padding:6px 0;text-align:right;font-weight:700">${money(b.balanceCents)}</td></tr></table>`;
  }

  const textFacts = (b, lang = b.lang) => { const w = W(lang); return `${w.date}: ${date(b.party_date, lang)}\n${w.time}: ${b.timeLabel} – ${b.endLabel}\n${w.pkg}: ${pkgName(b)} (${b.kids} ${w.kids})\n${w.ref}: ${b.ref}`; };
  const textMoney = (b, lang = b.lang) => { const w = W(lang); return `${w.total}: ${money(b.total_cents)}\n${w.paid}: ${money(b.paid_cents)}\n${w.balance}: ${money(b.balanceCents)}`; };
  const who = (b) => W(b.lang).who(b);
  const whoEn = (b) => WORDS.en.who(b);
  const strip = (h) => h.replace(/<[^>]+>/g, '');
  const needsShirts = (b) => b.quote.lines.some((l) => l.id === 'shirts') || (cfg.packages.find((p) => p.id === b.package_id)?.shirtsForAll && b.quote.shirtsIncluded !== false);

  // ---------- queueing ----------
  function queue({ kind, to, subject, html, text, dedupeKey = null, bookingId = null, leadId = null }) {
    const info = db.prepare(`INSERT OR IGNORE INTO emails (dedupe_key, booking_id, lead_id, kind, to_addr, subject, html, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(dedupeKey, bookingId, leadId, kind, to, subject, html, text);
    return info.changes > 0;
  }

  /** Text message — only to people who opted in. Logged in the same list as emails. */
  function queueSms({ kind, booking, body, dedupeKey, to: toPhone = null, optedIn = null }) {
    if (!(optedIn ?? booking?.sms_opt_in)) return false;
    const to = toE164(toPhone || booking?.phone);
    if (!to) return false;
    const lang = booking?.lang || 'en';
    const text = `${biz.shortName}: ${body} ${lang === 'es' ? 'Responda STOP para no recibir más.' : 'Reply STOP to opt out.'}`;
    const info = db.prepare(`INSERT OR IGNORE INTO emails (dedupe_key, booking_id, kind, to_addr, subject, html, text, channel)
      VALUES (?, ?, ?, ?, ?, '', ?, 'sms')`).run(dedupeKey ? `sms:${dedupeKey}` : null, booking?.id || null, kind, to, text.slice(0, 90), text);
    return info.changes > 0;
  }

  function toStaff(args) {
    for (const addr of cfg.emails.staffAlerts || []) queue({ ...args, to: addr, dedupeKey: args.dedupeKey ? `${args.dedupeKey}:${addr}` : null });
  }

  // ---------- event emails (called by the booking service) ----------
  function onPayment(booking, payment) {
    // A gift card used together with a card payment is folded into the confirmation that follows.
    if (payment.method === 'gift_card' && /\[split\]/.test(payment.note || '')) return;
    const b = svc.get(booking.id);
    const w = W(b.lang), L = b.lang;
    const first = !db.prepare(`SELECT 1 FROM emails WHERE dedupe_key = ?`).get(`booking_confirmed:${b.id}`);
    if (first) {
      queue({
        kind: 'booking_confirmed', to: b.email, bookingId: b.id, dedupeKey: `booking_confirmed:${b.id}`,
        subject: w.confirmedSubject(b, date(b.party_date, L)),
        html: wrap(w.confirmedHeading(b, who(b)), `<p>${esc(w.hiThanks(b, biz.name))}</p>${partyFacts(b)}${moneyFacts(b)}
          ${b.balanceCents > 0 ? `<p>${w.balanceDueBy(money(b.balanceCents), esc(date(b.balance_due_date, L)))}</p>` : ''}
          <p><b>${w.nextSteps}</b> (${w.nextStepsNote}):</p>
          <ol style="padding-left:20px;margin:0 0 12px">
            <li>${esc(w.stepDetails(needsShirts(b)))}</li>
            <li>${esc(w.stepInvite)} <a href="${esc(inviteLink(b))}">${esc(inviteLink(b))}</a>. ${esc(w.stepInviteAfter)}</li>
          </ol>
          ${b.access_code ? `<p style="background:#eef4ff;padding:12px;border-radius:8px">${w.codeBox(esc(b.access_code), esc(portalLink()))}</p>` : ''}
          ${b.referral_code ? `<p style="background:#f4f6f9;padding:10px 12px;border-radius:8px">${w.referralBox(esc(b.referral_code), money(cfg.referral.friendDiscountCents), money(cfg.referral.referrerCreditCents))}</p>` : ''}
          <p style="color:#5b6676;font-size:13px">${esc(w.depositNote(cfg.payments.depositPercent))}</p>`, { label: w.viewBooking, url: customerLink(b) }, { lang: L }),
        text: `${w.confirmedText(b, biz.name)}\n\n${textFacts(b)}\n\n${textMoney(b)}\n\n${w.stepInvite} ${inviteLink(b)}\n\n${b.access_code ? w.codeText(b.access_code, portalLink()) + '\n\n' : ''}${w.viewBooking}: ${customerLink(b)}`,
      });
      queueSms({ kind: 'sms_confirmed', booking: b, dedupeKey: `confirmed:${b.id}`, body: L === 'es'
        ? `${cap(who(b))} está reservada para el ${date(b.party_date, L)} a las ${b.timeLabel}. Detalles e invitación: ${customerLink(b)}`
        : `${who(b)} is booked for ${date(b.party_date, L)} at ${b.timeLabel}. Details & invite link: ${customerLink(b)}` });
      toStaff({
        kind: 'staff_new_booking', bookingId: b.id, dedupeKey: `staff_new_booking:${b.id}`,
        subject: `New party: ${b.child_name || b.parent_name} — ${fmtDate(b.party_date)} ${b.timeLabel}`,
        html: wrap('New party booked', `${partyFacts(b, 'en')}<p>${esc(b.parent_name)} · ${esc(b.email)} · ${esc(b.phone)}${b.lang === 'es' ? ' · <b>Prefers Spanish</b>' : ''}</p>${b.source && b.source !== 'web' ? `<p>Came from: ${esc(b.source)}</p>` : ''}${b.notes ? `<p><b>Notes:</b> ${esc(b.notes)}</p>` : ''}${moneyFacts(b, 'en')}`, { label: 'Open admin', url: `${baseUrl()}/admin` }),
        text: `New party booked\n\n${textFacts(b, 'en')}\n${b.parent_name} · ${b.email} · ${b.phone}\n\n${textMoney(b, 'en')}`,
      });
    } else {
      queue({
        kind: 'payment_received', to: b.email, bookingId: b.id, dedupeKey: `payment_received:${payment.id}`,
        subject: w.paymentSubject(money(payment.amount_cents), b.ref),
        html: wrap(w.paymentHeading(b.balanceCents === 0), `<p>${w.paymentBody({ parent_name: esc(b.parent_name) }, money(payment.amount_cents), esc(who(b)))}</p>${partyFacts(b)}${moneyFacts(b)}`, { label: w.viewReceipt, url: customerLink(b) }, { lang: L }),
        text: `${strip(w.paymentBody(b, money(payment.amount_cents), who(b)))}\n\n${textFacts(b)}\n\n${textMoney(b)}\n\n${customerLink(b)}`,
      });
    }
  }

  function onLead(lead) {
    const type = cfg.inquiryTypes.find((t) => t.id === lead.event_type)?.name || lead.event_type;
    queue({
      kind: 'lead_received', to: lead.email, leadId: lead.id, dedupeKey: `lead_received:${lead.id}`,
      subject: `We got your request — ${biz.name}`,
      html: wrap('Thanks — we got your request!', `<p>Hi ${esc(lead.name)}, thanks for your interest in a ${esc(type.toLowerCase())} at ${esc(biz.name)}. We'll get back to you within one business day with options and pricing.</p>`),
      text: `Hi ${lead.name}, thanks for your interest in a ${type.toLowerCase()} at ${biz.name}. We'll get back to you within one business day.`,
    });
    toStaff({
      kind: 'staff_new_lead', leadId: lead.id, dedupeKey: `staff_new_lead:${lead.id}`,
      subject: `New lead: ${type} — ${lead.name}${lead.organization ? ` (${lead.organization})` : ''}`,
      html: wrap(`New lead: ${type}`, `<p><b>${esc(lead.name)}</b>${lead.organization ? ` · ${esc(lead.organization)}` : ''}<br>${esc(lead.email)}${lead.phone ? ` · ${esc(lead.phone)}` : ''}</p>
        <p>Preferred date: ${esc(lead.preferred_date || '—')}${lead.end_date ? ` to ${esc(lead.end_date)}` : ''}${lead.vendor_count ? ` · Vendors/tables: ${esc(lead.vendor_count)}` : ''} · Group size: ${esc(lead.group_size || '—')}</p>${lead.message ? `<p>${esc(lead.message)}</p>` : ''}`, { label: 'Open leads', url: `${baseUrl()}/admin` }),
      text: `New lead: ${type}\n${lead.name} ${lead.organization || ''}\n${lead.email} ${lead.phone || ''}\nDate: ${lead.preferred_date || '-'}${lead.end_date ? ' to ' + lead.end_date : ''}${lead.vendor_count ? ' · Vendors: ' + lead.vendor_count : ''} · Size: ${lead.group_size || '-'}\n${lead.message || ''}`,
    });
  }

  // ---------- changes, video, waitlist ----------
  function onReschedule(b, { fromDate, fromTime, overpaidCents, credit, staff }) {
    const w = W(b.lang), L = b.lang;
    const key = `moved:${b.id}:${b.party_date}:${b.start_min}`;
    queue({ kind: 'party_moved', to: b.email, bookingId: b.id, dedupeKey: key,
      subject: w.movedSubject(date(b.party_date, L), b.timeLabel, b.ref),
      html: wrap(w.movedHeading, `<p>${esc(w.movedBody(b, `${date(fromDate, L)} ${fromTime}`))}</p>${partyFacts(b)}${moneyFacts(b)}
        ${credit ? `<p>${w.movedCredit(money(overpaidCents))}</p><p style="font-family:monospace;font-size:18px;text-align:center;background:#f4f6f9;padding:12px;border-radius:8px">${esc(credit.code)}</p>` : ''}
        ${b.balanceCents > 0 && b.status === 'confirmed' ? `<p>${w.movedMore(money(b.balanceCents), esc(date(b.balance_due_date, L)))}</p>` : ''}`, { label: w.viewBooking, url: customerLink(b) }, { lang: L }),
      text: `${w.movedBody(b, `${date(fromDate, L)} ${fromTime}`)}\n\n${textFacts(b)}\n\n${textMoney(b)}\n\n${customerLink(b)}` });
    const orders = db.prepare(`SELECT COUNT(*) n FROM vendor_orders WHERE booking_id = ? AND status NOT IN ('cancelled')`).get(b.id).n;
    const vendors = [...new Set(b.quote.lines.filter((l) => l.vendor && l.vendor !== 'NXGS').map((l) => l.vendor))];
    toStaff({ kind: 'staff_party_moved', bookingId: b.id, dedupeKey: `staff_${key}`,
      subject: `Party moved: ${b.child_name || b.parent_name} → ${fmtDate(b.party_date)} ${b.timeLabel}`,
      html: wrap('A party was moved', `<p>${esc(b.parent_name)} moved ${esc(whoEn(b))} from <b>${esc(fmtDate(fromDate))} ${esc(fromTime)}</b> to <b>${esc(fmtDate(b.party_date))} ${esc(b.timeLabel)}</b>${staff ? ' (by staff)' : ''}.</p>
        ${vendors.length || orders ? `<p><b>Tell these vendors the new date:</b> ${esc(vendors.join(', ') || '')}${orders ? ` (+${orders} partner order${orders > 1 ? 's' : ''})` : ''}</p>` : ''}
        ${overpaidCents ? `<p>The new price is ${money(overpaidCents)} lower than what they paid; ${credit ? `party credit ${esc(credit.code)} was issued automatically.` : 'issue a refund or credit.'}</p>` : ''}${moneyFacts(b, 'en')}`, { label: 'Open admin', url: `${baseUrl()}/admin` }),
      text: `Party moved: ${whoEn(b)} from ${fromDate} ${fromTime} to ${b.party_date} ${b.timeLabel}. Vendors: ${vendors.join(', ') || 'none'}` });
  }

  function onCustomerCancel(b, terms, { refundedCents = 0 } = {}) {
    const w = W(b.lang), L = b.lang;
    const refund = terms.refundCents;
    queue({ kind: 'party_cancelled', to: b.email, bookingId: b.id, dedupeKey: `cancelled:${b.id}`,
      subject: w.cancelledSubject(b.ref),
      html: wrap(w.cancelledHeading, `<p>${esc(w.cancelledBody(b, who(b), date(b.party_date, L)))}</p>
        <p>${refund > 0 ? w.refundLine(money(refund)) : esc(w.noRefundLine(cfg.payments.depositPercent, terms.refundMinDays))}</p><p>${esc(w.comeBack)}</p>`, { label: w.bookAgain, url: bookLink({ lang: L === 'es' ? 'es' : null }) }, { lang: L }),
      text: `${w.cancelledBody(b, who(b), date(b.party_date, L))}\n${strip(refund > 0 ? w.refundLine(money(refund)) : w.noRefundLine(cfg.payments.depositPercent, terms.refundMinDays))}` });
    const owed = refund - refundedCents;
    toStaff({ kind: 'staff_cancelled', bookingId: b.id, dedupeKey: `staff_cancelled:${b.id}`,
      subject: `Cancelled by family: ${b.child_name || b.parent_name} ${fmtDate(b.party_date)}${owed > 0 ? ` — refund ${money(owed)} owed` : ''}`,
      html: wrap('A family cancelled their party', `${partyFacts(b, 'en')}<p>${esc(b.parent_name)} · ${esc(b.email)} · ${esc(b.phone)}</p>
        <p>Paid: ${money(b.paid_cents + refundedCents)}. Refund due under the policy: <b>${money(refund)}</b>.${refundedCents ? ` ${money(refundedCents)} was refunded to their card automatically.` : ''}${owed > 0 ? ` <b>${money(owed)} still needs to be refunded by hand</b> (cash, check or gift card payments), then mark it refunded in Admin.` : ''}</p>
        <p>Cancel any vendor orders for this party.</p>`, { label: 'Open admin', url: `${baseUrl()}/admin` }),
      text: `Cancelled by family: ${b.ref}. Refund due ${money(refund)}, refunded automatically ${money(refundedCents)}.` });
  }

  function onVideo(b) {
    const w = W(b.lang);
    queue({ kind: 'highlight_video', to: b.email, bookingId: b.id, dedupeKey: `video:${b.id}:${b.video_url}`,
      subject: w.videoSubject(who(b)), html: wrap(w.videoHeading, `<p>${esc(w.videoBody(b, who(b)))}</p>`, { label: w.watchVideo, url: b.video_url }, { lang: b.lang }),
      text: `${w.videoBody(b, who(b))}\n${b.video_url}` });
  }

  function onWaitlistOpen(entry) {
    const w = W(entry.lang), L = entry.lang;
    const url = bookLink({ date: entry.party_date, location: entry.location_id, package: entry.package_id, kids: entry.kids, src: 'waitlist', lang: L === 'es' ? 'es' : null });
    const d = date(entry.party_date, L);
    queue({ kind: 'waitlist_open', to: entry.email, dedupeKey: `waitlist_open:${entry.id}:${entry.notified_at}`,
      subject: w.waitSubject(d), html: wrap(w.waitHeading, `<p>${w.waitBody({ parent_name: esc(entry.parent_name) }, esc(d))}</p>`, { label: w.waitButton, url }, { lang: L }),
      text: `${strip(w.waitBody(entry, d))}\n${url}` });
    queueSms({ kind: 'sms_waitlist', booking: { lang: L }, to: entry.phone, optedIn: entry.sms_opt_in, dedupeKey: `waitlist:${entry.id}:${entry.notified_at}`,
      body: L === 'es' ? `Se abrió un horario para fiestas el ${d}. Reserve aquí: ${url}` : `A party time just opened on ${d}. Grab it here: ${url}` });
  }

  // ---------- outside vendors ----------
  function onVendorOrder(vendor, orders, booking) {
    const b = svc.get(booking.id);
    const due = (b.start_min - 60);
    const dueLabel = `${Math.floor(due / 60) % 12 || 12}:${String(due % 60).padStart(2, '0')} ${due >= 720 ? 'PM' : 'AM'}`;
    const total = orders.reduce((s, o) => s + o.unit_cost_cents * o.qty, 0);
    const rows = orders.map((o) => `<tr><td style="padding:6px 0">${esc(o.product_name)}</td><td style="padding:6px 0;text-align:center">${o.qty}</td><td style="padding:6px 0;text-align:right">${money(o.unit_cost_cents)}</td><td style="padding:6px 0;text-align:right">${money(o.unit_cost_cents * o.qty)}</td></tr>`).join('');
    const personal = [b.child_name ? `Birthday child: ${b.child_name}${b.child_age ? ` (turning ${b.child_age})` : ''}` : '', b.themeInfo ? `Theme: ${b.themeInfo.name}` : '', b.details?.jerseyNumber ? `Jersey #: ${b.details.jerseyNumber}` : ''].filter(Boolean);
    queue({ kind: 'vendor_order', to: vendor.email, bookingId: b.id, dedupeKey: `vendor_order:${b.id}:${vendor.id}:${orders.map((o) => o.id).join('-')}`,
      subject: `New ${biz.shortName} order for ${fmtDate(b.party_date)} (${b.ref})`,
      html: wrap(`New order from ${biz.shortName}`, `<p>Hi ${esc(vendor.contact_name)}, a party at ${esc(b.location.name)} includes your products:</p>
        <table style="border-collapse:collapse;width:100%;margin:12px 0"><tr style="color:#5b6676;font-size:12px"><td>Item</td><td style="text-align:center">Qty</td><td style="text-align:right">Your price</td><td style="text-align:right">Total</td></tr>${rows}
        <tr><td colspan="3" style="padding:6px 0;font-weight:700;border-top:1px solid #dfe4eb">Total ${esc(biz.shortName)} pays you</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #dfe4eb">${money(total)}</td></tr></table>
        <p><b>Deliver to:</b> ${esc(b.location.name)}, ${esc(b.location.address)}<br><b>By:</b> ${esc(fmtDate(b.party_date))} at ${esc(dueLabel)} (1 hour before the party)</p>
        ${personal.length ? `<p><b>Personalization:</b><br>${personal.map(esc).join('<br>')}</p>` : ''}
        <p style="color:#5b6676;font-size:13px">Payment terms: ${esc(cfg.marketplace.payoutTerms)}. Please reply to confirm.</p>`),
      text: `New ${biz.shortName} order for ${fmtDate(b.party_date)} (${b.ref})\n${orders.map((o) => `${o.product_name} x${o.qty} @ ${money(o.unit_cost_cents)}`).join('\n')}\nTotal: ${money(total)}\nDeliver to ${b.location.name}, ${b.location.address} by ${dueLabel}\n${personal.join('\n')}` });
    toStaff({ kind: 'staff_vendor_order', bookingId: b.id, dedupeKey: `staff_vendor_order:${b.id}:${vendor.id}:${orders.map((o) => o.id).join('-')}`,
      subject: `Partner order: ${vendor.business_name} for ${b.ref}`,
      html: wrap('Partner order sent', `<p>${esc(vendor.business_name)} was sent an order for ${esc(b.child_name || b.parent_name)}'s party on ${esc(fmtDate(b.party_date))}: ${orders.map((o) => `${esc(o.product_name)} × ${o.qty}`).join(', ')}. ${esc(biz.shortName)} owes ${money(total)}.</p>`),
      text: `${vendor.business_name}: ${orders.map((o) => `${o.product_name} x${o.qty}`).join(', ')} for ${b.ref}. Owed ${money(total)}.` });
  }

  function onVendorApplied(vendor) {
    queue({ kind: 'vendor_applied', to: vendor.email, dedupeKey: `vendor_applied:${vendor.id}`,
      subject: `We got your application — ${biz.name}`,
      html: wrap('Thanks for applying!', `<p>Hi ${esc(vendor.contact_name)}, thanks for your interest in offering ${esc(vendor.business_name)} products at ${esc(biz.name)} parties and events. Our team will review your application and get back to you.</p>`),
      text: `Thanks for applying to sell at ${biz.name} events. We'll review your application and get back to you.` });
    toStaff({ kind: 'staff_vendor_applied', dedupeKey: `staff_vendor_applied:${vendor.id}`,
      subject: `New vendor application: ${vendor.business_name}`,
      html: wrap('New vendor application', `<p><b>${esc(vendor.business_name)}</b> (${esc(vendor.category || 'no category')})<br>${esc(vendor.contact_name)} · ${esc(vendor.email)}${vendor.phone ? ` · ${esc(vendor.phone)}` : ''}</p>${vendor.description ? `<p>${esc(vendor.description)}</p>` : ''}<p>Products: ${vendor.products.map((p) => `${esc(p.name)} (${money(p.cost_cents)})`).join(', ')}</p>`, { label: 'Review in Admin', url: `${baseUrl()}/admin#marketplace` }),
      text: `New vendor application: ${vendor.business_name} — ${vendor.contact_name}, ${vendor.email}` });
  }

  // ---------- gift cards & referral credits ----------
  function onGiftActivated(card) {
    const amount = money(card.initial_cents);
    const body = (greeting) => `<p>${greeting}</p>
      <div style="border:2px dashed ${cfg.brand.primaryColor};border-radius:12px;padding:16px;text-align:center;margin:12px 0">
        <div style="font-size:13px;color:#5b6676">${esc(biz.name)} gift card</div>
        <div style="font-size:30px;font-weight:800;margin:4px 0">${amount}</div>
        <div style="font-family:monospace;font-size:18px;letter-spacing:.06em">${esc(card.code)}</div>
      </div>
      ${card.message ? `<p style="font-style:italic">"${esc(card.message)}"</p>` : ''}
      <p>Enter the code when booking a party online, or show it at the front desk.</p>`;
    if (card.recipient_email) {
      queue({ kind: 'gift_card', to: card.recipient_email, dedupeKey: `gift_card:${card.id}`,
        subject: `You got a ${amount} ${biz.shortName} gift card${card.buyer_name ? ` from ${card.buyer_name}` : ''}!`,
        html: wrap(`A gift for ${card.recipient_name}!`, body(card.buyer_name ? `${esc(card.buyer_name)} sent you a gift card for parties and events at ${esc(biz.name)}.` : `Here's your gift card for ${esc(biz.name)}.`), { label: 'Book a party', url: `${baseUrl()}/book` }),
        text: `${card.buyer_name || 'Someone'} sent you a ${amount} ${biz.name} gift card.\nCode: ${card.code}\n${card.message ? `"${card.message}"\n` : ''}Book: ${baseUrl()}/book` });
    }
    if (card.buyer_email) {
      queue({ kind: 'gift_card_receipt', to: card.buyer_email, dedupeKey: `gift_card_receipt:${card.id}`,
        subject: `Your ${amount} gift card for ${card.recipient_name}`,
        html: wrap('Thanks for your gift card purchase', body(`Here's the gift card for ${esc(card.recipient_name)}${card.recipient_email ? `. We also emailed it to ${esc(card.recipient_email)}` : '. Print or forward this email to give it'}.`)),
        text: `Gift card for ${card.recipient_name}: ${amount}\nCode: ${card.code}` });
    }
  }

  function onReferralCredit(card, referrer) {
    queue({ kind: 'referral_credit', to: card.recipient_email, bookingId: referrer.id, dedupeKey: `referral_credit:${card.id}`,
      subject: `You earned ${money(card.initial_cents)} in party credit!`,
      html: wrap('Thanks for spreading the word!', `<p>Hi ${esc(referrer.parent_name)}, a family you referred just booked their party, so here's ${money(card.initial_cents)} in party credit.</p>
        <p style="font-family:monospace;font-size:18px;letter-spacing:.06em;text-align:center;background:#f4f6f9;padding:12px;border-radius:8px">${esc(card.code)}</p>
        <p>Use it on ${referrer.balanceCents > 0 ? 'your remaining balance or ' : ''}your next party. Enter the code at checkout.</p>`, { label: 'Use my credit', url: referrer.balanceCents > 0 ? customerLink(referrer) : `${baseUrl()}/book` }),
      text: `Thanks for referring a friend! Here's ${money(card.initial_cents)} in party credit: ${card.code}` });
  }

  // ---------- scheduled reminders ----------
  /** Queue whatever reminders are due today. Safe to run as often as you like: each goes once. */
  function queueReminders() {
    const now = clock();
    const [startHour, endHour] = cfg.emails.sendBetween;
    const hour = hourLocal(now, biz.timezone);
    if (hour < startHour || hour >= endHour) return 0;
    const today = todayLocal(now, biz.timezone);
    let n = 0;

    for (const b of svc.list({ from: today }).filter((x) => ['confirmed', 'paid'].includes(x.status))) {
      const w = W(b.lang), L = b.lang;
      // Balance reminder: from N days before the due date until it's due.
      if (b.status === 'confirmed' && b.balanceCents > 0 && b.balance_due_date) {
        const remindFrom = addDays(b.balance_due_date, -cfg.emails.balanceReminderDaysBefore);
        if (today >= remindFrom && today <= b.balance_due_date) {
          n += queue({
            kind: 'balance_reminder', to: b.email, bookingId: b.id, dedupeKey: `balance_reminder:${b.id}`,
            subject: w.reminderSubject(date(b.balance_due_date, L), b.ref),
            html: wrap(w.reminderHeading, `<p>${w.reminderBody({ parent_name: esc(b.parent_name) }, money(b.balanceCents), esc(who(b)), esc(date(b.balance_due_date, L)))}</p>${partyFacts(b)}${moneyFacts(b)}`, { label: w.pay(money(b.balanceCents)), url: customerLink(b) }, { lang: L }),
            text: `${strip(w.reminderBody(b, money(b.balanceCents), who(b), date(b.balance_due_date, L)))}\n\n${textFacts(b)}\n\n${customerLink(b)}`,
          }) ? 1 : 0;
          queueSms({ kind: 'sms_balance', booking: b, dedupeKey: `balance:${b.id}`, body: L === 'es'
            ? `El saldo de ${money(b.balanceCents)} de ${who(b)} vence el ${date(b.balance_due_date, L)}. Pague aquí: ${customerLink(b)}`
            : `Your ${money(b.balanceCents)} balance for ${who(b)} is due ${date(b.balance_due_date, L)}. Pay here: ${customerLink(b)}` });
        }
        // Overdue: once, the day after it was due.
        if (today > b.balance_due_date) {
          n += queue({
            kind: 'balance_overdue', to: b.email, bookingId: b.id, dedupeKey: `balance_overdue:${b.id}`,
            subject: w.overdueSubject(b.ref),
            html: wrap(w.overdueHeading, `<p>${w.overdueBody({ parent_name: esc(b.parent_name) }, money(b.balanceCents), esc(who(b)), esc(date(b.balance_due_date, L)))}</p>${partyFacts(b)}`, { label: w.pay(money(b.balanceCents)), url: customerLink(b) }, { lang: L }),
            text: `${strip(w.overdueBody(b, money(b.balanceCents), who(b), date(b.balance_due_date, L)))}\n${customerLink(b)}`,
          }) ? 1 : 0;
          toStaff({
            kind: 'staff_overdue', bookingId: b.id, dedupeKey: `staff_overdue:${b.id}`,
            subject: `Overdue balance: ${b.child_name || b.parent_name} ${fmtDate(b.party_date)} (${money(b.balanceCents)})`,
            html: wrap('Balance overdue', `${partyFacts(b, 'en')}<p>${esc(b.parent_name)} · ${esc(b.email)} · ${esc(b.phone)}</p>${moneyFacts(b, 'en')}`),
            text: `Overdue balance ${money(b.balanceCents)}\n${textFacts(b, 'en')}\n${b.parent_name} ${b.email} ${b.phone}`,
          });
        }
      }
      // Party details still missing, 10 days out (or right away for parties booked closer than that).
      const st = svc.detailsStatus(b);
      if (!st.complete && today >= addDays(b.party_date, -10)) {
        n += queue({
          kind: 'details_reminder', to: b.email, bookingId: b.id, dedupeKey: `details_reminder:${b.id}`,
          subject: w.detailsSubject(who(b)),
          html: wrap(w.detailsHeading, `<p>${esc(w.detailsBody(b, who(b), date(b.party_date, L)))}</p>
            <ul>${st.missing.map((m) => `<li>${esc(i18n.missingText(m, L))}</li>`).join('')}</ul><p>${esc(w.detailsAfter)}</p>`, { label: w.addDetails, url: `${customerLink(b)}#details` }, { lang: L }),
          text: `${w.detailsBody(b, who(b), date(b.party_date, L))} ${st.missing.map((m) => i18n.missingText(m, L)).join(', ')}.\n${customerLink(b)}#details`,
        }) ? 1 : 0;
      }
      // One week to go: what's left, by email and text. Skipped for parties booked inside that week.
      const weekFrom = addDays(b.party_date, -(cfg.emails.weekAheadDays || 7));
      if (today >= weekFrom && today <= addDays(b.party_date, -2) && String(b.created_at).slice(0, 10) < weekFrom) {
        const g7 = guests ? guests.partyGuests(b.id) : null;
        const todo = [];
        if (b.status === 'confirmed' && b.balanceCents > 0) todo.push(w.weekBalance(money(b.balanceCents), date(b.balance_due_date, L)));
        if (!st.complete) todo.push(w.weekDetails(st.missing.map((m) => i18n.missingText(m, L)).join(', ')));
        if (g7 && g7.yes + g7.no === 0) todo.push(w.weekInvite);
        if (g7 && g7.missingWaivers.length) todo.push(w.weekWaivers(g7.missingWaivers.length));
        n += queue({
          kind: 'week_ahead', to: b.email, bookingId: b.id, dedupeKey: `week_ahead:${b.id}`,
          subject: w.weekSubject(who(b)),
          html: wrap(w.weekHeading, `<p>${esc(w.weekBody(b, who(b)))}</p>${partyFacts(b)}${todo.length ? `<ul style="padding-left:20px">${todo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(w.weekAllSet)}</p>`}`, { label: w.weekButton, url: customerLink(b) }, { lang: L }),
          text: `${w.weekBody(b, who(b))}\n\n${textFacts(b)}\n\n${todo.length ? todo.map((x) => `- ${x}`).join('\n') : w.weekAllSet}\n\n${customerLink(b)}`,
        }) ? 1 : 0;
        queueSms({ kind: 'sms_week_ahead', booking: b, dedupeKey: `week_ahead:${b.id}`, body: w.weekSms(who(b), todo.length, customerLink(b)) });
      }
      // Party tomorrow.
      if (addDays(today, 1) === b.party_date) {
        const g = guests ? guests.partyGuests(b.id) : null;
        queueSms({ kind: 'sms_tomorrow', booking: b, dedupeKey: `tomorrow:${b.id}`, body: L === 'es'
          ? `¡Nos vemos mañana a las ${b.timeLabel} para ${who(b)}! Lleguen 10-15 min antes.${g && g.missingWaivers.length ? ` Faltan ${g.missingWaivers.length} exenciones: ${inviteLink(b)}` : ''}`
          : `See you tomorrow at ${b.timeLabel} for ${who(b)}! Please arrive 10-15 min early.${g && g.missingWaivers.length ? ` ${g.missingWaivers.length} guest waiver(s) still unsigned: ${inviteLink(b)}` : ''}` });
        n += queue({
          kind: 'party_tomorrow', to: b.email, bookingId: b.id, dedupeKey: `party_tomorrow:${b.id}`,
          subject: w.tomorrowSubject(b, biz.name),
          html: wrap(w.tomorrowHeading, `<p>${esc(w.tomorrowBody(b, who(b)))}</p>${partyFacts(b)}
            <p><b>${w.schedule}:</b><br>${b.schedule.map((s) => `${esc(s.from)} — ${esc(i18n.phaseLabel(s.label, L))}`).join('<br>')}</p>
            ${b.balanceCents > 0 ? `<p>${w.balanceRemaining(money(b.balanceCents))}</p>` : ''}
            ${g ? `<p>${w.guestsLine(g)}${g.missingWaivers.length ? ` ${esc(w.waiversNeeded(g.missingWaivers.join(', ')))}: <a href="${esc(inviteLink(b))}">${esc(inviteLink(b))}</a> ${esc(w.orFrontDesk)}.` : ''}</p>` : ''}`, { label: w.viewBooking, url: customerLink(b) }, { lang: L }),
          text: `${w.tomorrowBody(b, who(b))}\n\n${textFacts(b)}\n\n${b.schedule.map((s) => `${s.from} ${i18n.phaseLabel(s.label, L)}`).join('\n')}`,
        }) ? 1 : 0;
      }
    }

    // Review requests, the day after the party.
    const reviewDay = addDays(today, -cfg.reviews.askDaysAfter);
    for (const b of svc.list({ from: reviewDay, to: reviewDay }).filter((x) => ['confirmed', 'paid'].includes(x.status))) {
      if (db.prepare('SELECT 1 FROM reviews WHERE booking_id = ?').get(b.id)) continue;
      const w = W(b.lang);
      n += queue({
        kind: 'review_request', to: b.email, bookingId: b.id, dedupeKey: `review_request:${b.id}`,
        subject: w.reviewSubject(who(b)),
        html: wrap(w.reviewHeading, `<p>${esc(w.reviewBody(b))}</p>`, { label: w.reviewButton, url: `${customerLink(b)}#review` }, { lang: b.lang }),
        text: `${w.reviewBody(b)} ${customerLink(b)}#review`,
      }) ? 1 : 0;
    }

    // Thank-you with party credit for the next party, a week after.
    if (cfg.rebook && cfg.rebook.enabled && issueCredit) {
      const day = addDays(today, -cfg.rebook.afterDays);
      for (const b of svc.list({ from: day, to: day }).filter((x) => ['confirmed', 'paid'].includes(x.status))) {
        const key = `rebook:${b.id}`;
        if (db.prepare('SELECT 1 FROM emails WHERE dedupe_key = ?').get(key)) continue;
        // Already booked again? Then no gift is needed.
        if (db.prepare(`SELECT 1 FROM bookings WHERE lower(email) = lower(?) AND status IN ('confirmed','paid') AND party_date > ?`).get(b.email, today)) continue;
        const w = W(b.lang), L = b.lang === 'es' ? 'es' : 'en';
        const card = issueCredit({ amount: cfg.rebook.creditCents / 100, recipientName: b.parent_name, recipientEmail: b.email, message: `Thank-you credit for ${b.ref}`, sendEmail: false });
        const amt = money(card.initial_cents);
        n += queue({
          kind: 'rebook_offer', to: b.email, bookingId: b.id, dedupeKey: key,
          subject: w.rebookSubject,
          html: wrap(w.rebookHeading, `<p>${esc(w.rebookBody(b, amt))}</p><p style="font-family:monospace;font-size:18px;letter-spacing:.06em;text-align:center;background:#f4f6f9;padding:12px;border-radius:8px">${esc(card.code)}</p>`, { label: w.rebookButton, url: bookLink({ code: card.code, lang: L === 'es' ? 'es' : '' }) }, { lang: L }),
          text: `${w.rebookText(amt, card.code)}\n${bookLink({ code: card.code })}`,
        }) ? 1 : 0;
      }
    }

    n += queueRecovery(today);
    n += queueGuestOffers(today);
    return n;
  }

  /** "Your time is still open": a family who held a time but never paid, a few hours after the hold ran out. */
  function queueRecovery(today) {
    const r = cfg.recovery || {};
    if (!r.afterHours) return 0;
    const now = clock();
    const olderThan = new Date(now.getTime() - r.afterHours * 3600000).toISOString();
    const newerThan = new Date(now.getTime() - (r.withinDays || 3) * 86400000).toISOString();
    let n = 0;
    // hold_expires_at is when the unpaid hold ran out.
    const rows = db.prepare(`SELECT id FROM bookings WHERE status = 'expired' AND paid_cents = 0 AND hold_expires_at <= ? AND hold_expires_at >= ? AND party_date > ?`).all(olderThan, newerThan, today);
    for (const { id } of rows) {
      const b = svc.get(id);
      // Skip families who went on to book anyway.
      if (db.prepare(`SELECT 1 FROM bookings WHERE email = ? AND id <> ? AND status IN ('pending','confirmed','paid') AND created_at >= ?`).get(b.email, b.id, b.created_at)) continue;
      let open = false, anyOpen = false;
      try {
        const day = svc.availability(b.party_date, b.location_id, b.package_id);
        open = day.slots.some((s) => s.available && s.start === b.start_min);
        anyOpen = day.slots.some((s) => s.available);
      } catch { continue; } // too close to book online now
      const w = W(b.lang), L = b.lang, d = date(b.party_date, L);
      const addOns = b.quote.lines.filter((l) => l.kind === 'addon').map((l) => `${l.id}:${l.qty}`).join(',');
      const url = bookLink({ date: anyOpen ? b.party_date : null, time: open ? scheduling.toHHMM(b.start_min) : null,
        package: b.package_id, kids: b.kids, addons: addOns || null, location: b.location_id, src: 'recovery', lang: L === 'es' ? 'es' : null });
      n += queue({ kind: 'hold_recovery', to: b.email, bookingId: b.id, dedupeKey: `hold_recovery:${b.email}:${b.party_date}`,
        subject: open ? w.recoverySubject(d) : w.recoverySubjectGone(d),
        html: wrap(w.recoveryHeading, `<p>${esc(open ? w.recoveryBody(b, d, b.timeLabel) : w.recoveryBodyGone(b, d))}</p>`, { label: open ? w.recoveryButton : w.recoveryButtonGone, url }, { lang: L }),
        text: `${open ? w.recoveryBody(b, d, b.timeLabel) : w.recoveryBodyGone(b, d)}\n${url}` }) ? 1 : 0;
    }
    return n;
  }

  /** Guest families who opted in get a "your turn" offer a couple of days after the party they came to. */
  function queueGuestOffers(today) {
    if (!audience) return 0;
    const g = cfg.guestOffer || {};
    let n = 0;
    for (const c of audience.dueOffers(today)) {
      const host = svc.get(c.booking_id);
      const w = W(c.lang), L = c.lang;
      const url = bookLink({ code: host.referral_code, src: 'guest-offer', lang: L === 'es' ? 'es' : null });
      const unsub = `${baseUrl()}/unsubscribe?e=${encodeURIComponent(c.email)}&k=${audience.unsubscribeKey(c.email)}`;
      const sent = queue({ kind: 'guest_offer', to: c.email, bookingId: host.id, dedupeKey: `guest_offer:${host.id}:${c.email}`,
        subject: w.offerSubject(host.child_name),
        html: wrap(w.offerHeading, `<p>${esc(w.offerBody(c, host.child_name, biz.name))}</p>
          ${host.referral_code ? `<p>${w.offerCode(esc(host.referral_code), money(cfg.referral.friendDiscountCents))}</p>` : ''}
          ${g.programsText ? `<p>${esc(w.offerPrograms(g.programsText))}${g.programsUrl ? ` <a href="${esc(g.programsUrl)}">${esc(w.seePrograms)}</a>` : ''}</p>` : ''}`,
          { label: w.offerButton, url }, { lang: L, unsubscribe: unsub }),
        text: `${w.offerBody(c, host.child_name, biz.name)}\n${host.referral_code ? strip(w.offerCode(host.referral_code, money(cfg.referral.friendDiscountCents))) : ''}\n${url}\n\n${w.unsubscribe}: ${unsub}` });
      if (sent) { audience.markOffered(c.email); n++; }
    }
    return n;
  }

  /** Send everything queued. */
  async function flush() {
    const rows = db.prepare(`SELECT * FROM emails WHERE status IN ('queued','failed') AND attempts < ? ORDER BY id LIMIT 50`).all(MAX_ATTEMPTS);
    let sent = 0;
    for (const e of rows) {
      if (e.channel === 'sms') {
        if (!smsSender) {
          db.prepare(`UPDATE emails SET status = 'not_configured', error = 'Twilio not set up' WHERE id = ?`).run(e.id);
          continue;
        }
        try {
          const id = await smsSender({ to: e.to_addr, body: e.text });
          db.prepare(`UPDATE emails SET status = 'sent', provider_id = ?, attempts = attempts + 1, error = NULL, sent_at = datetime('now') WHERE id = ?`).run(id || null, e.id);
          sent++;
        } catch (err) {
          db.prepare(`UPDATE emails SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?`).run(String(err.message).slice(0, 500), e.id);
        }
        continue;
      }
      if (!sender) {
        db.prepare(`UPDATE emails SET status = 'not_configured', error = 'RESEND_API_KEY not set' WHERE id = ?`).run(e.id);
        continue;
      }
      try {
        const id = await sender({ from: cfg.emails.from, to: e.to_addr, replyTo: cfg.emails.replyTo, subject: e.subject, html: e.html, text: e.text });
        db.prepare(`UPDATE emails SET status = 'sent', provider_id = ?, attempts = attempts + 1, error = NULL, sent_at = datetime('now') WHERE id = ?`).run(id || null, e.id);
        sent++;
      } catch (err) {
        db.prepare(`UPDATE emails SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?`).run(String(err.message).slice(0, 500), e.id);
      }
    }
    return sent;
  }

  async function tick() {
    queueReminders();
    return flush();
  }

  function list(limit = 200) {
    return db.prepare(`SELECT id, booking_id, lead_id, kind, to_addr, subject, status, attempts, error, created_at, sent_at, channel FROM emails ORDER BY id DESC LIMIT ?`).all(limit);
  }

  function get(id) {
    return db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
  }

  /** Re-send one email (e.g. customer says they never got it). */
  function resend(id) {
    const e = get(id);
    if (!e) return null;
    db.prepare(`INSERT INTO emails (booking_id, lead_id, kind, to_addr, subject, html, text, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(e.booking_id, e.lead_id, e.kind, e.to_addr, e.subject, e.html, e.text, e.channel || 'email');
    return true;
  }

  /** "Email me my code": one email per active party on that address (at most one per party per hour). */
  function sendAccessCodes(bookings) {
    const bucket = Math.floor(clock().getTime() / 3600000);
    let n = 0;
    for (const b of bookings) {
      if (!b.access_code) continue;
      const L = b.lang === 'es' ? 'es' : 'en';
      const w = W(L);
      n += queue({
        kind: 'access_code', to: b.email, bookingId: b.id, dedupeKey: `access_code:${b.id}:${bucket}`,
        subject: w.codeSubject,
        html: wrap(w.codeHeading, `<p>${esc(w.codeBody(b.parent_name))}</p>${partyFacts(b)}<p style="background:#eef4ff;padding:12px;border-radius:8px">${w.codeBox(esc(b.access_code), esc(portalLink()))}</p>`, { label: w.viewBooking, url: customerLink(b) }, { lang: L }),
        text: `${w.codeBody(b.parent_name)}\n\n${w.codeText(b.access_code, portalLink())}\n\n${customerLink(b)}`,
      }) ? 1 : 0;
    }
    return n;
  }

  return { sendAccessCodes, onPayment, onLead, onReschedule, onCustomerCancel, onVideo, onWaitlistOpen, onGiftActivated, onReferralCredit, onVendorOrder, onVendorApplied, queueReminders, flush, tick, list, get, resend, enabled: !!sender, smsEnabled: !!smsSender };
}

module.exports = { createNotifier, resendSend, twilioSend, toE164, WORDS };
