/* In-browser runtime for the clickable preview.
 * Runs the real app (src/*.js) in the browser: a tiny CommonJS loader, small stand-ins for the
 * Node built-ins the app uses, and SQLite via sql.js. Pages load into an iframe and every
 * request they make goes to the app's real request handler.
 * The module and page placeholders below are filled in by tools/build-preview.js. */
(function () {
  const MODULES = __MODULES__;      // { 'config': 'source', ... }
  const PUBLIC = __PUBLIC__;        // { 'book.html': 'source', ... }
  const IMAGES = __IMAGES__;        // { '/static/img/field.jpg': 'data:...' }
  const HOST = 'nxgs-demo';
  const AUTH = 'Basic ' + btoa('admin:demo');

  // ---------- Node stand-ins ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  class Buffer extends Uint8Array {
    static from(v, encoding) {
      if (typeof v === 'string') {
        if (encoding === 'base64') return Buffer.from([...atob(v)].map((c) => c.charCodeAt(0)));
        if (encoding === 'hex') return Buffer.from(v.match(/../g)?.map((h) => parseInt(h, 16)) || []);
        const u = enc.encode(v); const b = new Buffer(u.length); b.set(u); return b;
      }
      const b = new Buffer(v.length); b.set(v); return b;
    }
    static concat(list) { const n = list.reduce((s, x) => s + x.length, 0); const b = new Buffer(n); let o = 0; for (const x of list) { b.set(x, o); o += x.length; } return b; }
    static byteLength(s) { return enc.encode(String(s)).length; }
    toString(encoding) {
      if (encoding === 'hex') return [...this].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (encoding === 'base64') return btoa(String.fromCharCode(...this));
      return dec.decode(this);
    }
  }
  // Demo-only hash (the preview has no secrets to protect).
  function digest32(s) {
    const out = new Buffer(32);
    let h = 2166136261;
    for (let r = 0; r < 32; r++) {
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 16777619) >>> 0; }
      out[r] = h & 255;
    }
    return out;
  }
  const hasher = (prefix) => { let s = prefix; const o = { update(x) { s += String(x); return o; }, digest(e) { const d = digest32(s); return e ? d.toString(e) : d; } }; return o; };
  const cryptoShim = {
    randomBytes(n) { const b = new Buffer(n); crypto.getRandomValues(b); return b; },
    randomUUID: () => (crypto.randomUUID ? crypto.randomUUID() : cryptoShim.randomBytes(16).toString('hex')),
    createHash: () => hasher(''),
    createHmac: (_a, key) => hasher(String(key) + '|'),
    timingSafeEqual: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  };
  const pathShim = {
    sep: '/',
    normalize(p) { const parts = []; for (const seg of p.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); } return '/' + parts.join('/'); },
    join: (...a) => pathShim.normalize(a.join('/')),
    extname: (p) => { const m = /\.[^./]+$/.exec(p); return m ? m[0] : ''; },
    dirname: (p) => p.replace(/\/[^/]*$/, '') || '/',
  };
  const fileAt = (p) => (p.startsWith('/app/public/') ? PUBLIC[p.slice('/app/public/'.length)] : undefined);
  const fsShim = {
    existsSync: (p) => fileAt(p) !== undefined,
    statSync: (p) => ({ isFile: () => fileAt(p) !== undefined }),
    createReadStream: (p) => ({ pipe: (res) => res.end(fileAt(p)) }),
    mkdirSync() {},
  };

  let SQL;
  class DatabaseSync {
    constructor() { this.db = new SQL.Database(); this.isTransaction = false; }
    exec(sql) {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('BEGIN')) this.isTransaction = true;
      if (s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) this.isTransaction = false;
      this.db.exec(sql);
    }
    prepare(sql) {
      const db = this.db;
      const args = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
      return {
        run: (...p) => {
          const st = db.prepare(sql); st.run(args(p)); st.free();
          const changes = db.getRowsModified();
          const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
          return { changes, lastInsertRowid: id };
        },
        get: (...p) => { const st = db.prepare(sql); st.bind(args(p)); const row = st.step() ? st.getAsObject() : undefined; st.free(); return row; },
        all: (...p) => { const st = db.prepare(sql); st.bind(args(p)); const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows; },
      };
    }
  }

  const process = { env: { ADMIN_PASSWORD: 'demo', DB_FILE: ':memory:' } };
  const builtins = { 'node:crypto': cryptoShim, 'node:path': pathShim, 'node:fs': fsShim, 'node:http': {}, 'node:sqlite': { DatabaseSync } };

  // ---------- CommonJS loader ----------
  const cache = {};
  function load(name) {
    if (builtins[name]) return builtins[name];
    const key = name.replace(/^\.\//, '').replace(/\.js$/, '');
    if (cache[key]) return cache[key].exports;
    if (!(key in MODULES)) throw new Error('Module not found: ' + name);
    const module = { exports: {} };
    cache[key] = module;
    new Function('require', 'module', 'exports', '__dirname', 'process', 'Buffer', MODULES[key])(load, module, module.exports, '/app/src', process, Buffer);
    return module.exports;
  }

  // ---------- calling the app ----------
  let app;
  function call(method, url, body) {
    return new Promise((resolve) => {
      const listeners = {};
      const req = {
        method, url, headers: { host: HOST, authorization: AUTH, 'content-type': 'application/json' },
        on(ev, cb) {
          listeners[ev] = cb;
          if (ev === 'end') queueMicrotask(() => { if (body) listeners.data?.(Buffer.from(body)); listeners.end(); });
          return req;
        },
        destroy() {},
      };
      const res = {
        status: 200, headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; },
        end(b) { resolve({ status: this.status, headers: this.headers, body: b == null ? '' : String(b) }); },
      };
      app.handle(req, res);
    });
  }
  const toPath = (u) => { const x = new URL(u, `http://${HOST}/`); return x.pathname + x.search + x.hash; };

  // ---------- the frame ----------
  const frame = document.getElementById('appFrame');
  const history = [];
  let current = '/';
  const onRoute = [];

  const CHILD_SHIM = `<script>
    (function(){
      var P = parent.__nxgs;
      window.fetch = function(u, init){ return P.fetch(u, init); };
      window.__nav = function(u){ P.navigate(u); };
      window.alert = function(m){ P.toast(m); };
      window.confirm = function(){ return true; };
      window.prompt = function(){ return 'Cancelled in the preview'; };
      document.addEventListener('click', function(e){
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var h = a.getAttribute('href');
        if (h.startsWith('/') || h.startsWith('http://${HOST}')) { e.preventDefault(); P.navigate(h, a.hasAttribute('download') ? 'DOWNLOAD' : 'GET'); }
      }, true);
      document.addEventListener('submit', function(e){
        var f = e.target; var act = f.getAttribute('action');
        if (!act) return;
        e.preventDefault(); P.navigate(act, (f.getAttribute('method') || 'GET').toUpperCase());
      }, true);
      function fixFrames(root){ (root.querySelectorAll ? root.querySelectorAll('iframe[src^="/"]') : []).forEach(function(f){ var s = f.getAttribute('src'); f.removeAttribute('src'); P.fetch(s).then(function(r){ return r.text(); }).then(function(t){ f.srcdoc = t; }); }); }
      new MutationObserver(function(ms){ ms.forEach(function(m){ m.addedNodes.forEach(function(n){ if (n.nodeType === 1) { if (n.matches('iframe[src^="/"]')) fixFrames(n.parentNode); else fixFrames(n); } }); }); })
        .observe(document.documentElement, { childList: true, subtree: true });
    })();
  <\/script>`;

  async function prepare(html, path) {
    const u = new URL(path, `http://${HOST}/`);
    // Inline stylesheets the page links to on the app.
    // Inline scripts the page loads from the app (e.g. the chat widget).
    for (const [tag, src] of [...html.matchAll(/<script src="(\/static\/[^"]+)"[^>]*><\/script>/g)]) {
      const r = await call('GET', src);
      html = html.replace(tag, () => `<script>${r.body.replace(/<\/script/gi, '<\\/script')}<\/script>`);
    }
    const links = [...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+)">/g)];
    for (const [tag, href] of links) {
      const r = await call('GET', href);
      html = html.replace(tag, `<style>${r.body}</style>`);
    }
    html = html
      .replace(/(?:window\.top\.|window\.)?location\.href\s*=\s*([^;]+);/g, '__nav($1);')
      .replace(/location\.search/g, '__search')
      .replace(/location\.hash/g, '__hash')
      .replace(/history\.replaceState\([^;]*\);/g, '');
    html = html.replace(/\/static\/img\/[\w-]+\.jpg/g, (m) => IMAGES[m] || m);
    const vars = `<script>var __search = ${JSON.stringify(u.search)}; var __hash = ${JSON.stringify(u.hash)};<\/script>`;
    return html.replace(/<head>/i, '<head>' + vars + CHILD_SHIM);
  }

  async function navigate(url, method = 'GET', fromHistory = false) {
    let path = toPath(url);
    if (method === 'DOWNLOAD') return toast('Downloads are turned off in the preview. In the real app this saves a CSV file for Excel or QuickBooks.');
    let r = await call(method, path);
    for (let i = 0; i < 5 && r.status >= 300 && r.status < 400; i++) { path = toPath(r.headers.location); r = await call('GET', path); }
    const type = r.headers['content-type'] || '';
    let html;
    if (type.startsWith('text/html')) html = r.body;
    else html = `<!doctype html><html><head></head><body style="font-family:system-ui;padding:24px"><p>${r.status === 404 ? 'Page not found.' : 'This page returns data, not a screen.'}</p><pre style="white-space:pre-wrap;color:#666">${String(r.status)} ${r.body.slice(0, 400).replace(/</g, '&lt;')}</pre></body></html>`;
    if (!fromHistory && current !== path) history.push(current);
    current = path;
    frame.srcdoc = await prepare(html, path);
    onRoute.forEach((f) => f(path));
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  window.__nxgs = {
    async fetch(u, init = {}) {
      const r = await call((init.method || 'GET').toUpperCase(), toPath(u), init.body);
      return new Response(r.body, { status: r.status, headers: r.headers });
    },
    navigate: (u, m) => navigate(u, m),
    toast,
  };

  // ---------- sample data so the calendar isn't empty ----------
  function seed(svc) {
    const today = new Date();
    const ymd = (d) => d.toLocaleDateString('en-CA');
    const days = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
    const nextDow = (from, dow) => { let d = days(from); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d; };
    const kids = [['Liam', 'Rivera'], ['Emma', 'Cohen'], ['Noah', 'Patel'], ['Ava', 'Murphy'], ['Mason', 'Russo'], ['Mia', 'Kim'], ['Lucas', "O'Brien"], ['Zoe', 'Santos'], ['Ethan', 'Greco'], ['Lily', 'Nguyen'], ['Jack', 'Esposito'], ['Ella', 'Ward'], ['Owen', 'Silva'], ['Nora', 'Brennan'], ['Leo', 'Marino']];
    let i = 0;
    const book = (date, time, opts = {}) => {
      const [child, last] = kids[i++ % kids.length];
      try {
        const b = svc.create({ packageId: opts.pkg || ['rookie', 'allstar', 'mvp'][i % 3], kids: opts.kids || 14 + (i % 6), partyDate: ymd(date), time,
          childName: child, childAge: 6 + (i % 7), parentName: `${['Dana', 'Chris', 'Jess', 'Mike', 'Tara', 'Rob'][i % 6]} ${last}`,
          email: `${child.toLowerCase()}.${last.toLowerCase().replace(/\W/g, '')}@example.com`, phone: `(516) 555-01${String(10 + i).slice(-2)}`, addOns: opts.addOns || {} });
        svc.recordPayment(b.id, { kind: b.quote.payInFull ? 'full' : 'deposit', method: 'demo', amountCents: b.deposit_cents, stripeSessionId: 'demo_seed_' + i });
        if (opts.paid) svc.recordPayment(b.id, { kind: 'balance', method: 'cash', amountCents: svc.get(b.id).balanceCents });
      } catch (e) { /* slot taken or too soon — skip */ }
    };
    const sat1 = nextDow(3, 6), sun1 = nextDow(3, 0), fri1 = nextDow(3, 5);
    const sat2 = nextDow(10, 6), sun2 = nextDow(10, 0), sat3 = nextDow(17, 6), sun3 = nextDow(17, 0), sat4 = nextDow(31, 6);
    book(fri1, '17:00');
    ['10:00', '10:30', '12:30', '13:00', '15:00', '15:30', '17:30', '18:00'].forEach((t) => book(sat1, t)); // fully booked Saturday
    ['11:00', '13:30', '16:00'].forEach((t) => book(sun1, t));
    ['10:00', '12:00', '12:30', '14:30', '15:00', '17:00'].forEach((t) => book(sat2, t, { addOns: { pizza: 2 } }));
    book(sun2, '12:00', { paid: true });
    book(sat3, '11:00', { addOns: { 'balloon-tower': 1, 'cake-topper': 1, medal: 16 } });
    book(sat3, '15:30');
    book(sat4, '13:00', { addOns: { backdrop: 1, tumbler: 15 } });
    svc.addBlock({ date: ymd(sun3), reason: 'Fall tournament' });
    svc.createLead({ eventType: 'corporate', name: 'Karen Lopez', organization: 'Northwell team outing', email: 'klopez@example.com', phone: '(516) 555-0199', preferredDate: ymd(days(24)), groupSize: 45, message: 'Looking for a Friday evening team-building event with food.' });
    svc.createLead({ eventType: 'team', name: 'Coach Dave Romano', organization: 'Massapequa 10U Travel', email: 'coach.dave@example.com', groupSize: 14, message: 'Winter skills clinic, 6 weeks on Sunday mornings.' });
  }

  // ---------- chat assistant: runs on in-page Claude (the viewer's own Claude) ----------
  const SAMPLE_MESSAGES = {
    not_granted: 'To chat in this preview, allow the page to use Claude when your app asks. On the live site the assistant runs on NXGS’s own account, so customers are never asked.',
    sampling_disabled: 'Claude isn’t available on this account, so the chat can’t run in the preview.',
    tools_unavailable: 'This app version can’t run the chat preview. Try the latest Claude app or claude.ai in a browser.',
    rate_limited: 'Too many messages in a short time. Give it a minute and try again.',
  };
  async function assistantRunner({ instructions, turns, tools }) {
    const sample = window.claude?.use ? await window.claude.use('sample') : null;
    if (!sample) throw Object.assign(new Error('unavailable'), { userMessage: 'The chat preview needs to be opened inside the Claude app or claude.ai.' });
    try {
      const { text } = await sample([{ role: 'user', content: instructions }, ...turns.slice(-30)], {
        modelTier: 'quick',
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, execute: (input) => t.execute(input) })),
      });
      return text;
    } catch (e) {
      throw Object.assign(new Error(e?.message || 'sample failed'), { userMessage: SAMPLE_MESSAGES[e?.code] || 'Sorry, I lost my connection for a second. Could you send that again?' });
    }
  }

  // ---------- boot ----------
  async function boot() {
    SQL = await initSqlJs();
    const { createApp } = load('server');
    const db = load('db').open(':memory:');
    app = createApp(db, { assistantRunner });
    seed(app.svc);
    await app.background();
    document.getElementById('loading').hidden = true;
    const start = (location.hash || '').slice(1);
    navigate({ book: '/book', admin: '/admin', calendar: '/calendar', chat: '/chat' }[start] || '/calendar');
  }

  window.preview = {
    go: (p) => navigate(p),
    back: () => { if (history.length) navigate(history.pop(), 'GET', true); },
    onRoute: (f) => onRoute.push(f),
  };

  boot().catch((e) => {
    console.error(e);
    document.getElementById('loading').innerHTML = '<p>The preview could not start in this browser. Try opening the link in Safari or Chrome.</p><p class="err">' + String(e.message).replace(/</g, '&lt;') + '</p>';
  });
})();
