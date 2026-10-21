// Chat assistant: talks with customers and books parties through the same booking engine the form uses.
// Runs on the Claude API when ANTHROPIC_API_KEY is set. It is friendly and conversational, but it never
// claims to be a person: if asked, it says it is NXGS's AI assistant and offers a staff follow-up.

const crypto = require('node:crypto');
const config = require('./config');
const { money, addDays } = require('./pricing');
const scheduling = require('./scheduling');
const { BookingError, todayLocal } = require('./bookings');
const { PricingError } = require('./pricing');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOOL_ROUNDS = 6;
const MAX_MESSAGE_CHARS = 1000;
const MAX_USER_MESSAGES = 60;     // per conversation
const MAX_BOOKINGS = 3;           // per conversation
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 40;                // messages per IP per 10 minutes

function createAssistant(db, svc, opts = {}) {
  const cfg = opts.config || config;
  const clock = opts.clock || (() => new Date());
  const http = opts.fetch || ((...a) => fetch(...a));
  const runner = opts.runner || null; // preview: runs the conversation through in-page Claude
  const name = () => cfg.assistant?.name || 'Riley';
  const model = () => process.env.ASSISTANT_MODEL || cfg.assistant?.model || 'claude-haiku-5-5';
  const enabled = () => !!(runner || process.env.ANTHROPIC_API_KEY);
  const ipHits = new Map();

  db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    messages_json TEXT NOT NULL DEFAULT '[]',     -- full Claude API history (tool calls included)
    transcript_json TEXT NOT NULL DEFAULT '[]',   -- what the customer saw, for the admin page
    user_messages INTEGER NOT NULL DEFAULT 0,
    bookings_json TEXT NOT NULL DEFAULT '[]',
    leads_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ---------- what the assistant knows ----------
  function instructions() {
    const now = clock();
    const today = todayLocal(now, cfg.business.timezone);
    const dayName = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const upcoming = Array.from({ length: 28 }, (_, i) => addDays(today, i)).map((d) => `${dayName(d)} = ${d}`).join('; ');
    const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const hours = Object.entries(cfg.partyHours).filter(([, h]) => h).map(([d, h]) => `${days[d]} ${scheduling.label12(scheduling.toMinutes(h.open))}–${scheduling.label12(scheduling.toMinutes(h.close))}`).join(', ');
    const pkgs = cfg.packages.filter((p) => p.active !== false).map((p) => `- ${p.name} (id "${p.id}"): ${money(p.priceCents)}, includes ${p.includedKids} kids, ${money(p.extraKidCents)} per extra child. Includes: ${(p.includes || p.description).split('\n').join('; ')}`).join('\n');
    const cats = Object.fromEntries((cfg.addOnCategories || []).map((c) => [c.id, c.name]));
    const addOns = cfg.addOns.filter((a) => a.active !== false).map((a) => `- ${a.name} (id "${a.id}", ${cats[a.category] || a.category}): ${money(a.priceCents)}/${a.unit}${a.minQty > 1 ? `, min ${a.minQty}` : ''}${a.maxQty === 1 ? ', one per party' : ''}${a.leadDays ? `, order ${a.leadDays}+ days before the party` : ''}${a.includes ? `. Includes: ${a.includes.split('\n').join('; ')}` : ''}`).join('\n');
    const p = cfg.payments;
    return `You are ${name()}, the virtual party planner for ${cfg.business.name} (NXGS), a new indoor sports complex in Farmingdale, NY. You chat with parents and organizers on the NXGS website and help them book kids birthday parties.

WHO YOU ARE
- You are an AI assistant. Sound like a friendly, upbeat person at the front desk: warm, casual, quick. But never claim or imply you are human. If anyone asks whether you're a real person or a bot, say plainly that you're NXGS's AI assistant, and offer to have someone from the NXGS team call or email them (use request_staff_followup).
- Keep replies short: usually 1–3 sentences, like texting. Ask one question at a time. Use the person's first name once you know it. An emoji now and then is fine; don't overdo it.
- Plain text only. No markdown headings, tables or bold. For a short list of options, put each on its own line starting with "• ".
- Don't write anything before calling a tool (no "let me check"). Call the tool, then answer.

FACTS (never invent others; if you don't know, offer a staff follow-up)
- Today is ${dayName(today)} (${today}), time zone ${cfg.business.timezone}. Next four weeks: ${upcoming}.
- Kids parties are 2 hours: ${cfg.party.phases.map((ph) => `${ph.minutes} min ${ph.label.toLowerCase()}`).join(', then ')}. Up to ${cfg.party.maxKids} kids.
- Parties run ${hours}. Book at least ${cfg.minDaysAhead} days ahead; for anything sooner, offer a staff follow-up.
- Packages:
${pkgs}
- Add-ons (optional):
${addOns}
- Payment: a ${p.depositPercent}% non-refundable deposit reserves the party; the balance is due ${p.balanceDueDaysBefore} days before. Parties less than ${p.balanceDueDaysBefore} days away are paid in full. Sales tax is added. Payment happens on a secure checkout page: NEVER ask for or accept card numbers in chat.
- Corporate events, adult events, senior groups and team skill-building get a custom quote from staff: collect the details and use submit_inquiry.

HOW TO BOOK
1. Find out the date (or which weekend), roughly how many kids, and the package. Help them choose if unsure. Use check_times or find_open_dates for availability: never guess times or say a day is open without checking.
2. Use get_quote to give the exact price, deposit and balance.
3. Ask for the parent's full name, email and phone, and the birthday child's first name and age (age is optional). Mention any allergy or special request goes in the notes.
4. Before booking, recap date, start time, package, kids, add-ons and total, and get a clear yes.
5. Call book_party. Then tell them the time is held for ${p.holdMinutes} minutes and to tap the payment button that appears in the chat to pay the deposit and confirm. Don't paste the link yourself.

BOUNDARIES
- Only discuss NXGS parties, events and the facility. Politely steer anything else back.
- Never share other customers' bookings or details. Never change prices or promise discounts; for discounts, refunds, cancellations, complaints, medical questions, or anything unusual, use request_staff_followup.
- Don't collect information you don't need.`;
  }

  // ---------- tools ----------
  const pkgIds = () => cfg.packages.filter((p) => p.active !== false).map((p) => p.id);
  const addOnSchema = { type: 'object', description: 'Add-on id → quantity, e.g. {"pizza": 2, "favor-box": 15}', additionalProperties: { type: 'integer', minimum: 0 } };

  const tools = [
    {
      name: 'find_open_dates',
      description: 'Find upcoming dates that still have open party start times. Returns up to 10 dates with how many start times are open. Use when the customer is flexible or asks what is available.',
      input_schema: { type: 'object', properties: {
        from_date: { type: 'string', description: 'YYYY-MM-DD, earliest date to consider (default: today)' },
        to_date: { type: 'string', description: 'YYYY-MM-DD, latest date to consider (default: 6 weeks out)' },
        weekdays: { type: 'array', items: { type: 'string', enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, description: 'Only these days of the week' },
      } },
      run(input) {
        const today = todayLocal(clock(), cfg.business.timezone);
        const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from_date || '') ? input.from_date : today;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(input.to_date || '') ? input.to_date : addDays(from, 42);
        const want = Array.isArray(input.weekdays) && input.weekdays.length ? input.weekdays : null;
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const out = [];
        let month = from.slice(0, 7);
        for (let i = 0; i < 4 && out.length < 10 && month <= to.slice(0, 7); i++) {
          for (const d of svc.calendarMonth(month).days) {
            if (d.date < from || d.date > to || !['open', 'few'].includes(d.status)) continue;
            const dow = names[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
            if (want && !want.includes(dow)) continue;
            out.push({ date: d.date, day: dow, open_start_times: d.available });
            if (out.length >= 10) break;
          }
          const [y, m] = month.split('-').map(Number);
          month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
        }
        return out.length ? { dates: out } : { dates: [], note: 'No open dates in that range.' };
      },
    },
    {
      name: 'check_times',
      description: 'List the open party start times on one date (each party is 2 hours). Returns open times, or says the day is closed or fully booked.',
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
      run(input) {
        const day = svc.availability(String(input.date || ''));
        if (!day.open) return { date: input.date, open: false, note: 'No parties that day.' };
        const open = day.slots.filter((s) => s.available).map((s) => ({ start: s.time, label: `${s.label}–${s.endLabel}` }));
        return { date: input.date, open_times: open, note: open.length ? undefined : 'Fully booked.' };
      },
    },
    {
      name: 'get_quote',
      description: 'Exact price for a party: line items, tax, total, deposit due today and balance due date.',
      input_schema: { type: 'object', properties: {
        package_id: { type: 'string', enum: pkgIds() },
        kids: { type: 'integer', minimum: 1 },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        add_ons: addOnSchema,
      }, required: ['package_id', 'kids', 'party_date'] },
      run(input) {
        const q = svc.quoteFor({ packageId: input.package_id, kids: Number(input.kids), partyDate: String(input.party_date || ''), addOns: input.add_ons || {} });
        return {
          lines: q.lines.map((l) => `${l.name}${l.qty > 1 ? ` x${l.qty}` : ''}: ${money(l.totalCents)}`),
          subtotal: money(q.subtotalCents), tax: money(q.taxCents), total: money(q.totalCents),
          due_today: money(q.depositCents), paid_in_full_today: q.payInFull,
          balance: money(q.balanceCents), balance_due_date: q.balanceDueDate,
        };
      },
    },
    {
      name: 'book_party',
      description: 'Reserve the party once the customer has confirmed every detail. Holds the time and shows the customer a secure payment button for the deposit. Returns the booking number.',
      input_schema: { type: 'object', properties: {
        package_id: { type: 'string', enum: pkgIds() },
        kids: { type: 'integer', minimum: 1 },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string', description: 'HH:MM 24-hour, one of the open start times' },
        add_ons: addOnSchema,
        parent_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        child_name: { type: 'string' },
        child_age: { type: 'integer' },
        notes: { type: 'string', description: 'Allergies, theme, special requests' },
      }, required: ['package_id', 'kids', 'party_date', 'start_time', 'parent_name', 'email', 'phone'] },
      async run(input, ctx) {
        if (ctx.session.bookings.length >= MAX_BOOKINGS) throw new BookingError('Too many bookings from one chat. Offer a staff follow-up instead.');
        const b = svc.create({
          packageId: input.package_id, kids: Number(input.kids), partyDate: String(input.party_date || ''), time: String(input.start_time || ''),
          addOns: input.add_ons || {}, parentName: input.parent_name, email: input.email, phone: input.phone,
          childName: input.child_name, childAge: input.child_age, notes: [input.notes, 'Booked through the chat assistant.'].filter(Boolean).join('\n'),
        });
        const url = await ctx.checkout(b);
        ctx.session.bookings.push(b.ref);
        ctx.actions.push({ type: 'checkout', url, ref: b.ref, label: b.quote.payInFull ? `Pay ${money(b.deposit_cents)} to confirm` : `Pay ${money(b.deposit_cents)} deposit to confirm` });
        return { booking_number: b.ref, held_minutes: cfg.payments.holdMinutes, due_now: money(b.deposit_cents), note: 'A payment button is now showing in the chat.' };
      },
    },
    {
      name: 'submit_inquiry',
      description: 'Send a group, corporate, adult, senior or team skill-building request to staff, who reply with a quote. Returns a confirmation.',
      input_schema: { type: 'object', properties: {
        event_type: { type: 'string', enum: cfg.inquiryTypes.map((t) => t.id) },
        name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, organization: { type: 'string' },
        preferred_date: { type: 'string', description: 'YYYY-MM-DD if known' }, group_size: { type: 'integer' }, details: { type: 'string' },
      }, required: ['event_type', 'name', 'email'] },
      run(input, ctx) {
        const lead = svc.createLead({ eventType: input.event_type, name: input.name, email: input.email, phone: input.phone, organization: input.organization,
          preferredDate: input.preferred_date, groupSize: input.group_size, message: [input.details, '(from the chat assistant)'].filter(Boolean).join(' ') });
        ctx.session.leads.push(lead.id);
        return { ok: true, note: 'Staff will reply within one business day.' };
      },
    },
    {
      name: 'request_staff_followup',
      description: 'Ask an NXGS team member to call or email the customer: for a real person, last-minute dates, discounts, refunds, complaints, or anything you cannot handle.',
      input_schema: { type: 'object', properties: {
        name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, reason: { type: 'string' },
      }, required: ['name', 'reason'] },
      run(input, ctx) {
        if (!input.email && !input.phone) throw new BookingError('Ask for a phone number or email first.');
        const lead = svc.createLead({ eventType: 'other', name: input.name, email: input.email || 'no-email@chat.nxgs', phone: input.phone,
          message: `Chat follow-up requested: ${input.reason}` });
        ctx.session.leads.push(lead.id);
        return { ok: true, note: 'The NXGS team will reach out within one business day.' };
      },
    },
  ];

  async function runTool(t, input, ctx) {
    try {
      return { ok: true, content: JSON.stringify(await t.run(input || {}, ctx)) };
    } catch (e) {
      if (e instanceof BookingError || e instanceof PricingError) return { ok: false, content: e.message };
      console.error('assistant tool failed', t.name, e);
      return { ok: false, content: 'That did not work. Offer the booking form or a staff follow-up.' };
    }
  }

  // ---------- sessions ----------
  function loadSession(id) {
    const row = id && db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(String(id).slice(0, 64));
    if (row) return { id: row.id, messages: JSON.parse(row.messages_json), transcript: JSON.parse(row.transcript_json), userMessages: row.user_messages, bookings: JSON.parse(row.bookings_json), leads: JSON.parse(row.leads_json), isNew: false };
    return { id: crypto.randomBytes(12).toString('hex'), messages: [], transcript: [], userMessages: 0, bookings: [], leads: [], isNew: true };
  }
  function saveSession(s) {
    // Keep the conversation from growing without limit; cut only at a plain customer message.
    while (s.messages.length > 80) {
      s.messages.shift();
      while (s.messages.length && !(s.messages[0].role === 'user' && typeof s.messages[0].content === 'string')) s.messages.shift();
    }
    db.prepare(`INSERT INTO chat_sessions (id, messages_json, transcript_json, user_messages, bookings_json, leads_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json, transcript_json = excluded.transcript_json, user_messages = excluded.user_messages,
      bookings_json = excluded.bookings_json, leads_json = excluded.leads_json, updated_at = datetime('now')`)
      .run(s.id, JSON.stringify(s.messages), JSON.stringify(s.transcript), s.userMessages, JSON.stringify(s.bookings), JSON.stringify(s.leads));
  }

  function rateLimited(ip) {
    if (!ip) return false;
    const now = clock().getTime();
    const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
    hits.push(now);
    ipHits.set(ip, hits);
    return hits.length > IP_MAX;
  }

  // ---------- Claude API ----------
  async function callClaude(messages) {
    const res = await http(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model(),
        max_tokens: 1024,
        system: instructions(),
        tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        messages,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${data.error?.message || 'error'}`);
    return data;
  }

  async function replyViaApi(session, ctx) {
    let text = '';
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await callClaude(session.messages);
      session.messages.push({ role: 'assistant', content: res.content });
      text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (res.stop_reason !== 'tool_use') return text;
      const results = [];
      for (const block of res.content.filter((b) => b.type === 'tool_use')) {
        const t = tools.find((x) => x.name === block.name);
        const r = t ? await runTool(t, block.input, ctx) : { ok: false, content: 'Unknown tool' };
        results.push({ type: 'tool_result', tool_use_id: block.id, content: r.content, ...(r.ok ? {} : { is_error: true }) });
      }
      session.messages.push({ role: 'user', content: results });
    }
    return text || "Sorry, I got a little tangled up there. Could you say that again?";
  }

  async function replyViaRunner(session, ctx) {
    // In-page Claude (preview): plain text turns plus the same tools, run right here.
    const turns = session.transcript.filter((t) => t.role === 'user' || t.role === 'assistant').map((t) => ({ role: t.role, content: t.text }));
    return runner({
      instructions: instructions(),
      turns,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, execute: async (input) => {
        const r = await runTool(t, input, ctx);
        if (!r.ok) throw new Error(r.content);
        return r.content;
      } })),
    });
  }

  /**
   * One customer message in, one reply out.
   * @returns {Promise<{sessionId, reply, actions}>}
   */
  async function chat({ sessionId, message, ip, checkout }) {
    const text = String(message ?? '').trim();
    if (!text) throw new BookingError('Type a message first.');
    if (text.length > MAX_MESSAGE_CHARS) throw new BookingError(`Please keep messages under ${MAX_MESSAGE_CHARS} characters.`);
    const session = loadSession(sessionId);
    if (!enabled()) {
      return { sessionId: session.id, reply: "Our chat assistant isn't switched on yet. You can book right on this page, or send a request on the Group & corporate tab and we'll get back to you.", actions: [] };
    }
    if (rateLimited(ip) || session.userMessages >= MAX_USER_MESSAGES) {
      return { sessionId: session.id, reply: "We've been chatting a lot! To keep things moving, please finish on the booking form or send a request and the team will follow up.", actions: [] };
    }

    const at = clock().toISOString();
    session.userMessages++;
    session.transcript.push({ role: 'user', text, at });
    session.messages.push({ role: 'user', content: text });
    const ctx = { session, actions: [], checkout };

    let reply;
    try {
      reply = runner ? await replyViaRunner(session, ctx) : await replyViaApi(session, ctx);
    } catch (e) {
      console.error('assistant failed:', e.message);
      reply = e.userMessage || "Sorry, I'm having trouble on my end right now. You can book with the form on this page, or try me again in a minute.";
      // Keep the API history valid for the next turn: it must end on an assistant message.
      session.messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] });
    }
    reply = String(reply || '').trim() || 'Sorry, could you say that again?';
    session.transcript.push({ role: 'assistant', text: reply, at: clock().toISOString(), actions: ctx.actions });
    saveSession(session);
    return { sessionId: session.id, reply, actions: ctx.actions };
  }

  function list(limit = 100) {
    return db.prepare(`SELECT id, user_messages, bookings_json, leads_json, transcript_json, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ?`).all(limit)
      .map((r) => {
        const t = JSON.parse(r.transcript_json);
        return { id: r.id, messages: r.user_messages, bookings: JSON.parse(r.bookings_json), leads: JSON.parse(r.leads_json).length, first: t.find((x) => x.role === 'user')?.text?.slice(0, 120) || '', created_at: r.created_at, updated_at: r.updated_at };
      });
  }

  function transcript(id) {
    const r = db.prepare('SELECT transcript_json, bookings_json FROM chat_sessions WHERE id = ?').get(String(id));
    return r ? { id, transcript: JSON.parse(r.transcript_json), bookings: JSON.parse(r.bookings_json) } : null;
  }

  return { chat, list, transcript, enabled, instructions, tools, name };
}

module.exports = { createAssistant };
