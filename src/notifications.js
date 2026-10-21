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

function createNotifier(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const baseUrl = () => (opts.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const sender = opts.sender || (process.env.RESEND_API_KEY ? resendSend : null);
  const biz = cfg.business;

  const customerLink = (b) => `${baseUrl()}/booking/${b.ref}?t=${b.token}`;

  // ---------- layout ----------
  function wrap(heading, bodyHtml, button) {
    const c = cfg.brand.primaryColor;
    const logo = cfg.brand.logoUrl ? `<img src="${esc(cfg.brand.logoUrl)}" alt="${esc(biz.name)}" style="max-height:48px;margin-bottom:12px">` : `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6676">${esc(biz.name)}</div>`;
    const btn = button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:${c};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;display:inline-block">${esc(button.label)}</a></p>` : '';
    return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#0f1b2d">
      <div style="max-width:560px;margin:0 auto;padding:24px 16px">
        <div style="background:#fff;border:1px solid #dfe4eb;border-radius:12px;padding:24px">
          ${logo}
          <h1 style="font-size:22px;margin:8px 0 12px">${esc(heading)}</h1>
          ${bodyHtml}
          ${btn}
        </div>
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

  function toStaff(args) {
    for (const addr of cfg.emails.staffAlerts || []) queue({ ...args, to: addr, dedupeKey: args.dedupeKey ? `${args.dedupeKey}:${addr}` : null });
  }

  // ---------- event emails (called by the booking service) ----------
  function onPayment(booking, payment) {
    const b = svc.get(booking.id);
    const first = b.paid_cents === payment.amount_cents; // this payment was the first one
    if (first) {
      const heading = b.status === 'paid' ? `You're booked! ${who(b)} is paid in full` : `You're booked! Deposit received for ${who(b)}`;
      queue({
        kind: 'booking_confirmed', to: b.email, bookingId: b.id, dedupeKey: `booking_confirmed:${b.id}`,
        subject: `Party confirmed — ${fmtDate(b.party_date)} at ${b.timeLabel} (${b.ref})`,
        html: wrap(heading, `<p>Hi ${esc(b.parent_name)}, thanks for booking with ${esc(biz.name)}!</p>${partyFacts(b)}${moneyFacts(b)}
          ${b.balanceCents > 0 ? `<p>The remaining <b>${money(b.balanceCents)}</b> is due by <b>${esc(fmtDate(b.balance_due_date))}</b>. You can pay it anytime from your booking page.</p>` : ''}
          <p style="color:#5b6676;font-size:13px">The ${cfg.payments.depositPercent}% deposit is non-refundable.</p>`, { label: 'View my booking', url: customerLink(b) }),
        text: `Hi ${b.parent_name}, thanks for booking with ${biz.name}!\n\n${textFacts(b)}\n\n${textMoney(b)}\n${b.balanceCents > 0 ? `Balance due by ${fmtDate(b.balance_due_date)}.\n` : ''}\nView or pay: ${customerLink(b)}`,
      });
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
      // Party tomorrow.
      if (addDays(today, 1) === b.party_date) {
        n += queue({
          kind: 'party_tomorrow', to: b.email, bookingId: b.id, dedupeKey: `party_tomorrow:${b.id}`,
          subject: `See you tomorrow at ${b.timeLabel}! — ${biz.name}`,
          html: wrap(`See you tomorrow!`, `<p>Hi ${esc(b.parent_name)}, we're getting ready for ${esc(who(b))}. Please arrive about 10–15 minutes early.</p>${partyFacts(b)}
            <p><b>Schedule:</b><br>${b.schedule.map((s) => `${esc(s.from)} — ${esc(s.label)}`).join('<br>')}</p>
            ${b.balanceCents > 0 ? `<p>Balance remaining: <b>${money(b.balanceCents)}</b>.</p>` : ''}`, { label: 'View my booking', url: customerLink(b) }),
          text: `See you tomorrow for ${who(b)}! Please arrive 10–15 minutes early.\n\n${textFacts(b)}\n\n${b.schedule.map((s) => `${s.from} ${s.label}`).join('\n')}`,
        }) ? 1 : 0;
      }
    }
    return n;
  }

  /** Send everything queued. */
  async function flush() {
    const rows = db.prepare(`SELECT * FROM emails WHERE status IN ('queued','failed') AND attempts < ? ORDER BY id LIMIT 50`).all(MAX_ATTEMPTS);
    let sent = 0;
    for (const e of rows) {
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
    return db.prepare(`SELECT id, booking_id, lead_id, kind, to_addr, subject, status, attempts, error, created_at, sent_at FROM emails ORDER BY id DESC LIMIT ?`).all(limit);
  }

  function get(id) {
    return db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
  }

  /** Re-send one email (e.g. customer says they never got it). */
  function resend(id) {
    const e = get(id);
    if (!e) return null;
    db.prepare(`INSERT INTO emails (booking_id, lead_id, kind, to_addr, subject, html, text) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(e.booking_id, e.lead_id, e.kind, e.to_addr, e.subject, e.html, e.text);
    return true;
  }

  return { onPayment, onLead, queueReminders, flush, tick, list, get, resend, enabled: !!sender };
}

module.exports = { createNotifier, resendSend };
