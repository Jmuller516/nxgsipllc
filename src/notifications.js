// Automatic emails: confirmations, receipts, reminders and staff alerts.
// Every email is written to the `emails` table first (the admin "Emails" tab), then sent.
// Sending uses Resend (https://resend.com) when RESEND_API_KEY is set; otherwise emails are
// recorded as "not_configured" so you can see exactly what customers would have received.

const config = require('./config');
const { money, addDays } = require('./pricing');
const { todayLocal } = require('./bookings');

const MAX_ATTEMPTS = 5;

function hourLocal(now, tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

const fmtDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const baseUrl = () => (opts.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const sender = opts.sender || (process.env.RESEND_API_KEY ? resendSend : null);
  const smsSender = opts.smsSender || (twilioReady() ? twilioSend : null);
  const guests = opts.guests || null;
  const sponsors = opts.sponsors || null;
  const biz = cfg.business;

  const customerLink = (b) => `${baseUrl()}/booking/${b.ref}?t=${b.token}`;
  const inviteLink = (b) => `${baseUrl()}/invite/${b.invite_token}`;

  // ---------- layout ----------
  function wrap(heading, bodyHtml, button) {
    const c = cfg.brand.primaryColor;
    const logo = cfg.brand.logoUrl ? `<img src="${esc(cfg.brand.logoUrl)}" alt="${esc(biz.name)}" style="max-height:48px;margin-bottom:12px">` : `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6676">${esc(biz.name)}</div>`;
    const btn = button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:${c};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;display:inline-block">${esc(button.label)}</a></p>` : '';
    const sp = sponsors ? sponsors.forPlacement('email', null, { count: true }) : [];
    const spLine = sp.length ? `<p style="font-size:12px;color:#5b6676;text-align:center;margin:12px 0 0">Parties presented by ${sp.map((x) => x.hasLink ? `<a href="${esc(baseUrl())}/s/${x.id}" style="color:#5b6676">${esc(x.name)}</a>` : esc(x.name)).join(' · ')}</p>` : '';
    return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#0f1b2d">
      <div style="max-width:560px;margin:0 auto;padding:24px 16px">
        <div style="background:#fff;border:1px solid #dfe4eb;border-radius:12px;padding:24px">
          ${logo}
          <h1 style="font-size:22px;margin:8px 0 12px">${esc(heading)}</h1>
          ${bodyHtml}
          ${btn}
        </div>
        ${spLine}
        <p style="font-size:12px;color:#5b6676;text-align:center;margin-top:16px">${esc(biz.name)} · <a href="${esc(biz.website)}" style="color:#5b6676">${esc(biz.website.replace(/^https?:\/\//, ''))}</a> · Reply to this email with any questions.</p>
      </div></body></html>`;
  }

  function partyFacts(b) {
    const rows = [
      ['Date', fmtDate(b.party_date)],
      ['Time', `${b.timeLabel} – ${b.endLabel}`],
      ['Package', `${b.packageName} · ${b.kids} kids`],
      ['Booking #', b.ref],
    ];
    return `<table style="border-collapse:collapse;width:100%;margin:12px 0">${rows.map(([k, v]) =>
      `<tr><td style="padding:6px 0;color:#5b6676;width:110px">${k}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`;
  }

  function moneyFacts(b) {
    return `<table style="border-collapse:collapse;width:100%;margin:12px 0;border-top:1px solid #dfe4eb">
      <tr><td style="padding:6px 0">Total</td><td style="padding:6px 0;text-align:right">${money(b.total_cents)}</td></tr>
      <tr><td style="padding:6px 0">Paid so far</td><td style="padding:6px 0;text-align:right">${money(b.paid_cents)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700">Balance</td><td style="padding:6px 0;text-align:right;font-weight:700">${money(b.balanceCents)}</td></tr></table>`;
  }

  const textFacts = (b) => `Date: ${fmtDate(b.party_date)}\nTime: ${b.timeLabel} – ${b.endLabel}\nPackage: ${b.packageName} (${b.kids} kids)\nBooking #: ${b.ref}`;
  const textMoney = (b) => `Total: ${money(b.total_cents)}\nPaid: ${money(b.paid_cents)}\nBalance: ${money(b.balanceCents)}`;
  const who = (b) => (b.child_name ? `${b.child_name}'s party` : 'your party');

  // ---------- queueing ----------
  function queue({ kind, to, subject, html, text, dedupeKey = null, bookingId = null, leadId = null }) {
    const info = db.prepare(`INSERT OR IGNORE INTO emails (dedupe_key, booking_id, lead_id, kind, to_addr, subject, html, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(dedupeKey, bookingId, leadId, kind, to, subject, html, text);
    return info.changes > 0;
  }

  /** Text message — only to customers who opted in at booking. Logged in the same list as emails. */
  function queueSms({ kind, booking, body, dedupeKey }) {
    if (!booking.sms_opt_in) return false;
    const to = toE164(booking.phone);
    if (!to) return false;
    const text = `NXGS: ${body} Reply STOP to opt out.`;
    const info = db.prepare(`INSERT OR IGNORE INTO emails (dedupe_key, booking_id, kind, to_addr, subject, html, text, channel)
      VALUES (?, ?, ?, ?, ?, '', ?, 'sms')`).run(dedupeKey ? `sms:${dedupeKey}` : null, booking.id, kind, to, text.slice(0, 90), text);
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
    const first = !db.prepare(`SELECT 1 FROM emails WHERE dedupe_key = ?`).get(`booking_confirmed:${b.id}`);
    if (first) {
      const heading = b.status === 'paid' ? `You're booked! ${who(b)} is paid in full` : `You're booked! Deposit received for ${who(b)}`;
      queue({
        kind: 'booking_confirmed', to: b.email, bookingId: b.id, dedupeKey: `booking_confirmed:${b.id}`,
        subject: `Party confirmed — ${fmtDate(b.party_date)} at ${b.timeLabel} (${b.ref})`,
        html: wrap(heading, `<p>Hi ${esc(b.parent_name)}, thanks for booking with ${esc(biz.name)}!</p>${partyFacts(b)}${moneyFacts(b)}
          ${b.balanceCents > 0 ? `<p>The remaining <b>${money(b.balanceCents)}</b> is due by <b>${esc(fmtDate(b.balance_due_date))}</b>. You can pay it anytime from your booking page.</p>` : ''}
          <p><b>Next steps</b> (all on your booking page):</p>
          <ol style="padding-left:20px;margin:0 0 12px">
            <li>Fill in your party details (theme, name spelling, allergies${b.quote.lines.some((l) => l.id === 'shirts') ? ', shirt sizes' : ''}).</li>
            <li>Send your invitation link to guests: <a href="${esc(inviteLink(b))}">${esc(inviteLink(b))}</a>. Guests RSVP and sign the waiver online.</li>
          </ol>
          ${b.referral_code ? `<p style="background:#f4f6f9;padding:10px 12px;border-radius:8px">Know another family planning a party? Share your code <b>${esc(b.referral_code)}</b>: they get ${money(cfg.referral.friendDiscountCents)} off and you get ${money(cfg.referral.referrerCreditCents)} in party credit.</p>` : ''}
          <p style="color:#5b6676;font-size:13px">The ${cfg.payments.depositPercent}% deposit is non-refundable.</p>`, { label: 'View my booking', url: customerLink(b) }),
        text: `Hi ${b.parent_name}, thanks for booking with ${biz.name}!\n\n${textFacts(b)}\n\n${textMoney(b)}\n${b.balanceCents > 0 ? `Balance due by ${fmtDate(b.balance_due_date)}.\n` : ''}\nNext: fill in your party details and send this invitation link to guests: ${inviteLink(b)}\n\nView or pay: ${customerLink(b)}`,
      });
      queueSms({ kind: 'sms_confirmed', booking: b, dedupeKey: `confirmed:${b.id}`, body: `${who(b)} is booked for ${fmtDate(b.party_date)} at ${b.timeLabel}. Details & invite link: ${customerLink(b)}` });
      toStaff({
        kind: 'staff_new_booking', bookingId: b.id, dedupeKey: `staff_new_booking:${b.id}`,
        subject: `New party: ${b.child_name || b.parent_name} — ${fmtDate(b.party_date)} ${b.timeLabel}`,
        html: wrap('New party booked', `${partyFacts(b)}<p>${esc(b.parent_name)} · ${esc(b.email)} · ${esc(b.phone)}</p>${b.notes ? `<p><b>Notes:</b> ${esc(b.notes)}</p>` : ''}${moneyFacts(b)}`, { label: 'Open admin', url: `${baseUrl()}/admin` }),
        text: `New party booked\n\n${textFacts(b)}\n${b.parent_name} · ${b.email} · ${b.phone}\n\n${textMoney(b)}`,
      });
    } else {
      queue({
        kind: 'payment_received', to: b.email, bookingId: b.id, dedupeKey: `payment_received:${payment.id}`,
        subject: `Payment received — ${money(payment.amount_cents)} (${b.ref})`,
        html: wrap(b.balanceCents === 0 ? "Thanks — you're paid in full!" : 'Payment received', `<p>Hi ${esc(b.parent_name)}, we received <b>${money(payment.amount_cents)}</b> for ${esc(who(b))}.</p>${partyFacts(b)}${moneyFacts(b)}`, { label: 'View my receipt', url: customerLink(b) }),
        text: `We received ${money(payment.amount_cents)} for ${who(b)}.\n\n${textFacts(b)}\n\n${textMoney(b)}\n\nReceipt: ${customerLink(b)}`,
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
        <p>Preferred date: ${esc(lead.preferred_date || '—')} · Group size: ${esc(lead.group_size || '—')}</p>${lead.message ? `<p>${esc(lead.message)}</p>` : ''}`, { label: 'Open leads', url: `${baseUrl()}/admin` }),
      text: `New lead: ${type}\n${lead.name} ${lead.organization || ''}\n${lead.email} ${lead.phone || ''}\nDate: ${lead.preferred_date || '-'} · Size: ${lead.group_size || '-'}\n${lead.message || ''}`,
    });
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
      subject: `New NXGS order for ${fmtDate(b.party_date)} (${b.ref})`,
      html: wrap(`New order from ${biz.shortName}`, `<p>Hi ${esc(vendor.contact_name)}, a party at ${esc(b.location.name)} includes your products:</p>
        <table style="border-collapse:collapse;width:100%;margin:12px 0"><tr style="color:#5b6676;font-size:12px"><td>Item</td><td style="text-align:center">Qty</td><td style="text-align:right">Your price</td><td style="text-align:right">Total</td></tr>${rows}
        <tr><td colspan="3" style="padding:6px 0;font-weight:700;border-top:1px solid #dfe4eb">Total NXGS pays you</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #dfe4eb">${money(total)}</td></tr></table>
        <p><b>Deliver to:</b> ${esc(b.location.name)}, ${esc(b.location.address)}<br><b>By:</b> ${esc(fmtDate(b.party_date))} at ${esc(dueLabel)} (1 hour before the party)</p>
        ${personal.length ? `<p><b>Personalization:</b><br>${personal.map(esc).join('<br>')}</p>` : ''}
        <p style="color:#5b6676;font-size:13px">Payment terms: ${esc(cfg.marketplace.payoutTerms)}. Please reply to confirm.</p>`),
      text: `New NXGS order for ${fmtDate(b.party_date)} (${b.ref})\n${orders.map((o) => `${o.product_name} x${o.qty} @ ${money(o.unit_cost_cents)}`).join('\n')}\nTotal: ${money(total)}\nDeliver to ${b.location.name}, ${b.location.address} by ${dueLabel}\n${personal.join('\n')}` });
    toStaff({ kind: 'staff_vendor_order', bookingId: b.id, dedupeKey: `staff_vendor_order:${b.id}:${vendor.id}:${orders.map((o) => o.id).join('-')}`,
      subject: `Partner order: ${vendor.business_name} for ${b.ref}`,
      html: wrap('Partner order sent', `<p>${esc(vendor.business_name)} was sent an order for ${esc(b.child_name || b.parent_name)}'s party on ${esc(fmtDate(b.party_date))}: ${orders.map((o) => `${esc(o.product_name)} × ${o.qty}`).join(', ')}. NXGS owes ${money(total)}.</p>`),
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
      // Balance reminder: from N days before the due date until it's due.
      if (b.status === 'confirmed' && b.balanceCents > 0 && b.balance_due_date) {
        const remindFrom = addDays(b.balance_due_date, -cfg.emails.balanceReminderDaysBefore);
        if (today >= remindFrom && today <= b.balance_due_date) {
          n += queue({
            kind: 'balance_reminder', to: b.email, bookingId: b.id, dedupeKey: `balance_reminder:${b.id}`,
            subject: `Balance due ${fmtDate(b.balance_due_date)} — ${b.ref}`,
            html: wrap(`Your balance is due soon`, `<p>Hi ${esc(b.parent_name)}, just a reminder that the remaining <b>${money(b.balanceCents)}</b> for ${esc(who(b))} is due by <b>${esc(fmtDate(b.balance_due_date))}</b>.</p>${partyFacts(b)}${moneyFacts(b)}`, { label: `Pay ${money(b.balanceCents)}`, url: customerLink(b) }),
            text: `Reminder: ${money(b.balanceCents)} for ${who(b)} is due by ${fmtDate(b.balance_due_date)}.\n\n${textFacts(b)}\n\nPay here: ${customerLink(b)}`,
          }) ? 1 : 0;
          queueSms({ kind: 'sms_balance', booking: b, dedupeKey: `balance:${b.id}`, body: `Your ${money(b.balanceCents)} balance for ${who(b)} is due ${fmtDate(b.balance_due_date)}. Pay here: ${customerLink(b)}` });
        }
        // Overdue: once, the day after it was due.
        if (today > b.balance_due_date) {
          n += queue({
            kind: 'balance_overdue', to: b.email, bookingId: b.id, dedupeKey: `balance_overdue:${b.id}`,
            subject: `Balance past due — ${b.ref}`,
            html: wrap('Your balance is past due', `<p>Hi ${esc(b.parent_name)}, the remaining <b>${money(b.balanceCents)}</b> for ${esc(who(b))} was due ${esc(fmtDate(b.balance_due_date))}. Please pay it before the party, or reply and let us know if you have questions.</p>${partyFacts(b)}`, { label: `Pay ${money(b.balanceCents)}`, url: customerLink(b) }),
            text: `The remaining ${money(b.balanceCents)} for ${who(b)} was due ${fmtDate(b.balance_due_date)}.\nPay here: ${customerLink(b)}`,
          }) ? 1 : 0;
          toStaff({
            kind: 'staff_overdue', bookingId: b.id, dedupeKey: `staff_overdue:${b.id}`,
            subject: `Overdue balance: ${b.child_name || b.parent_name} ${fmtDate(b.party_date)} (${money(b.balanceCents)})`,
            html: wrap('Balance overdue', `${partyFacts(b)}<p>${esc(b.parent_name)} · ${esc(b.email)} · ${esc(b.phone)}</p>${moneyFacts(b)}`),
            text: `Overdue balance ${money(b.balanceCents)}\n${textFacts(b)}\n${b.parent_name} ${b.email} ${b.phone}`,
          });
        }
      }
      // Party details still missing, 10 days out (or right away for parties booked closer than that).
      const st = svc.detailsStatus(b);
      if (!st.complete && today >= addDays(b.party_date, -10)) {
        n += queue({
          kind: 'details_reminder', to: b.email, bookingId: b.id, dedupeKey: `details_reminder:${b.id}`,
          subject: `A few details needed for ${who(b)}`,
          html: wrap('Help us get everything ready', `<p>Hi ${esc(b.parent_name)}, we still need a few things for ${esc(who(b))} on ${esc(fmtDate(b.party_date))}:</p>
            <ul>${st.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p>It only takes a minute.</p>`, { label: 'Add party details', url: `${customerLink(b)}#details` }),
          text: `We still need: ${st.missing.join(', ')}.\nAdd them here: ${customerLink(b)}#details`,
        }) ? 1 : 0;
      }
      // Party tomorrow.
      if (addDays(today, 1) === b.party_date) {
        const g = guests ? guests.partyGuests(b.id) : null;
        queueSms({ kind: 'sms_tomorrow', booking: b, dedupeKey: `tomorrow:${b.id}`, body: `See you tomorrow at ${b.timeLabel} for ${who(b)}! Please arrive 10-15 min early.${g && g.missingWaivers.length ? ` ${g.missingWaivers.length} guest waiver(s) still unsigned: ${inviteLink(b)}` : ''}` });
        n += queue({
          kind: 'party_tomorrow', to: b.email, bookingId: b.id, dedupeKey: `party_tomorrow:${b.id}`,
          subject: `See you tomorrow at ${b.timeLabel}! — ${biz.name}`,
          html: wrap(`See you tomorrow!`, `<p>Hi ${esc(b.parent_name)}, we're getting ready for ${esc(who(b))}. Please arrive about 10–15 minutes early.</p>${partyFacts(b)}
            <p><b>Schedule:</b><br>${b.schedule.map((s) => `${esc(s.from)} — ${esc(s.label)}`).join('<br>')}</p>
            ${b.balanceCents > 0 ? `<p>Balance remaining: <b>${money(b.balanceCents)}</b>.</p>` : ''}
            ${g ? `<p><b>Guests:</b> ${g.yes} coming. <b>Waivers:</b> ${g.waiversSigned} of ${g.waiversNeeded} signed.${g.missingWaivers.length ? ` Still needed for: ${esc(g.missingWaivers.join(', '))}. Guests can sign at your invitation link: <a href="${esc(inviteLink(b))}">${esc(inviteLink(b))}</a> (or at the front desk).` : ''}</p>` : ''}`, { label: 'View my booking', url: customerLink(b) }),
          text: `See you tomorrow for ${who(b)}! Please arrive 10–15 minutes early.\n\n${textFacts(b)}\n\n${b.schedule.map((s) => `${s.from} ${s.label}`).join('\n')}`,
        }) ? 1 : 0;
      }
    }

    // Review requests, the day after the party.
    const reviewDay = addDays(today, -cfg.reviews.askDaysAfter);
    for (const b of svc.list({ from: reviewDay, to: reviewDay }).filter((x) => ['confirmed', 'paid'].includes(x.status))) {
      if (db.prepare('SELECT 1 FROM reviews WHERE booking_id = ?').get(b.id)) continue;
      n += queue({
        kind: 'review_request', to: b.email, bookingId: b.id, dedupeKey: `review_request:${b.id}`,
        subject: `How was ${who(b)}?`,
        html: wrap('Thanks for celebrating with us!', `<p>Hi ${esc(b.parent_name)}, we hope ${esc(b.child_name || 'everyone')} had a blast. Would you take 30 seconds to tell us how it went?</p>`, { label: 'Leave a quick review', url: `${customerLink(b)}#review` }),
        text: `Thanks for celebrating with us! How did it go? ${customerLink(b)}#review`,
      }) ? 1 : 0;
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

  return { onPayment, onLead, onGiftActivated, onReferralCredit, onVendorOrder, onVendorApplied, queueReminders, flush, tick, list, get, resend, enabled: !!sender, smsEnabled: !!smsSender };
}

module.exports = { createNotifier, resendSend, twilioSend, toE164 };
