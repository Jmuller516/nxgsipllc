const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { open } = require('../src/db');
const { createService } = require('../src/bookings');
const { createAssistant } = require('../src/assistant');

const NOW = new Date('2026-11-01T14:00:00Z');

function setup(script, opts = {}) {
  const db = open(':memory:');
  const svc = createService(db, config, () => NOW);
  const requests = [];
  // A scripted stand-in for the Claude API: each call returns the next response in `script`.
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, body });
    const next = script.shift();
    const content = typeof next === 'function' ? next(body) : next;
    return { ok: true, status: 200, json: async () => content };
  };
  const assistant = createAssistant(db, svc, { clock: () => NOW, fetch: fakeFetch, ...opts });
  const checkout = async (b) => `https://book.nxgs.net/pay/demo?ref=${b.ref}`;
  return { db, svc, assistant, requests, checkout };
}

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolCall = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

test('assistant checks times, books the party and hands back a payment button', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const { assistant, svc, requests, checkout } = setup([
      toolCall('t1', 'check_times', { date: '2026-11-14' }),
      text('Saturday the 14th has lots open! Noon works. Want me to grab it?'),
      toolCall('t2', 'book_party', { package_id: 'allstar', kids: 16, party_date: '2026-11-14', start_time: '12:00',
        parent_name: 'Dana Rivera', email: 'dana@example.com', phone: '516-555-0101', child_name: 'Liam', child_age: 7, notes: 'Peanut allergy' }),
      text("You're all set, Dana! Tap the button below to pay the deposit."),
    ]);

    const r1 = await assistant.chat({ message: 'Can we do a party on Saturday Nov 14 around noon?', checkout });
    assert.match(r1.reply, /Noon works/);
    assert.equal(r1.actions.length, 0);
    // the tool result went back to Claude, paired with its tool_use
    const second = requests[1].body.messages;
    assert.equal(second.at(-1).role, 'user');
    assert.equal(second.at(-1).content[0].type, 'tool_result');
    assert.equal(second.at(-1).content[0].tool_use_id, 't1');
    assert.match(second.at(-1).content[0].content, /"start":"12:00"/);
    assert.equal(requests[0].headers['x-api-key'], 'test-key');
    assert.equal(requests[0].body.model, 'claude-haiku-5-5');

    const r2 = await assistant.chat({ sessionId: r1.sessionId, message: 'Yes please, book it', checkout });
    assert.equal(r2.sessionId, r1.sessionId);
    assert.equal(r2.actions.length, 1);
    assert.equal(r2.actions[0].type, 'checkout');
    assert.match(r2.actions[0].url, /pay\/demo\?ref=NX-/);
    const b = svc.getByRef(r2.actions[0].ref);
    assert.equal(b.status, 'pending');
    assert.equal(b.kids, 16);
    assert.match(b.notes, /Peanut allergy/);
    assert.match(b.notes, /chat assistant/);

    // conversation history carried across turns
    assert.ok(requests[2].body.messages.length >= 5);
    const list = assistant.list();
    assert.equal(list[0].bookings[0], b.ref);
    assert.equal(assistant.transcript(r1.sessionId).transcript.length, 4);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('tool errors go back to Claude as errors instead of crashing', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  try {
    const { assistant, requests, checkout } = setup([
      toolCall('t1', 'get_quote', { package_id: 'rookie', kids: 25, party_date: '2026-11-14' }),
      text('Our parties max out at 20 kids. Want to look at 20?'),
    ]);
    const r = await assistant.chat({ message: 'price for 25 kids?', checkout });
    const result = requests[1].body.messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /limited to 20 kids/);
    assert.match(r.reply, /20 kids/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('instructions are honest about being an AI and carry live prices and dates', () => {
  const { assistant } = setup([]);
  const p = assistant.instructions();
  assert.match(p, /You are an AI assistant/);
  assert.match(p, /never claim or imply you are human/);
  assert.match(p, /NEVER ask for or accept card numbers/);
  assert.match(p, /Rookie Party \(id "rookie"\): \$450\.00/);
  assert.match(p, /Today is Sun, Nov 1 \(2026-11-01\)/);
  assert.match(p, /Sat, Nov 14 = 2026-11-14/);
});

test('without an API key the chat explains it is off; limits are enforced', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { assistant, checkout } = setup([]);
  const r = await assistant.chat({ message: 'hi', checkout });
  assert.match(r.reply, /isn't switched on yet/);
  assert.equal(assistant.enabled(), false);
  await assert.rejects(assistant.chat({ message: 'x'.repeat(1001), checkout }), /under 1000 characters/);
  await assert.rejects(assistant.chat({ message: '   ', checkout }), /Type a message/);
});

test('an API outage gives a friendly reply and keeps the history valid', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  try {
    const { assistant, checkout, requests } = setup([]);
    const failing = createAssistant(open(':memory:'), createService(open(':memory:'), config, () => NOW), {
      clock: () => NOW, fetch: async () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) }),
    });
    const r = await failing.chat({ message: 'hello', checkout });
    assert.match(r.reply, /trouble on my end/);
    assert.equal(requests.length, 0);
    assert.ok(assistant);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('preview mode runs the same tools through an in-page runner', async () => {
  let seen;
  const runner = async ({ instructions, turns, tools }) => {
    seen = { instructions, turns, names: tools.map((t) => t.name) };
    const out = JSON.parse(await tools.find((t) => t.name === 'find_open_dates').execute({ weekdays: ['Sat'] }));
    await assert.rejects(tools.find((t) => t.name === 'check_times').execute({ date: '2026-11-09' }).then((r) => { if (/open":false/.test(r)) throw new Error('closed'); }), /closed/);
    return `Next open Saturday is ${out.dates[0].date}.`;
  };
  const { assistant, checkout } = setup([], { runner });
  const r = await assistant.chat({ message: 'Which Saturdays are open?', checkout });
  assert.equal(r.reply, 'Next open Saturday is 2026-11-07.');
  assert.deepEqual(seen.turns, [{ role: 'user', content: 'Which Saturdays are open?' }]);
  assert.ok(seen.names.includes('book_party'));
  assert.match(seen.instructions, /virtual party planner/);
});

test('rate limit per visitor', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  try {
    const script = Array.from({ length: 60 }, () => text('ok'));
    const { assistant, checkout } = setup(script);
    let last;
    for (let i = 0; i < 41; i++) last = await assistant.chat({ message: 'hi ' + i, ip: '1.2.3.4', checkout });
    assert.match(last.reply, /chatting a lot/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
