/*
 * NXGS chat assistant widget.
 * On our pages it shows a chat bubble in the corner. On /chat it fills the page.
 * On another site (e.g. nxgs.net): <script src="https://book.nxgs.net/static/chat.js" defer></script>
 */
(function () {
  if (window.__nxgsChat) return;
  window.__nxgsChat = true;
  var script = document.currentScript;
  var API = '';
  try { if (script && script.src) API = new URL(script.src).origin; } catch (e) {}
  var inline = document.getElementById('nxgs-chat-page');

  var css = `
  .nxc, .nxc * { box-sizing: border-box; }
  .nxc { --nxc-brand: var(--brand, #0b4fd6); --nxc-bg: var(--card, #fff); --nxc-ink: var(--ink, #0f1b2d); --nxc-muted: var(--muted, #5b6676);
    --nxc-line: var(--line, #dfe4eb); --nxc-soft: var(--bg, #f4f6f9); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--nxc-ink); }
  @media (prefers-color-scheme: dark) { .nxc { --nxc-bg: var(--card, #141c2e); --nxc-ink: var(--ink, #e9eef7); --nxc-muted: var(--muted, #9aa6b8); --nxc-line: var(--line, #26324a); --nxc-soft: var(--bg, #0c1220); } }
  .nxc-bubble { position: fixed; right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 2147483000;
    display: flex; align-items: center; gap: 10px; border: 0; border-radius: 999px; padding: 12px 18px 12px 12px; background: var(--nxc-brand); color: #fff;
    font: 600 15px/1 system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgb(0 0 0 / .25); cursor: pointer; }
  .nxc-bubble .nxc-av { width: 30px; height: 30px; font-size: 14px; background: #fff; color: var(--nxc-brand); }
  .nxc-bubble:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
  .nxc-panel { position: fixed; right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 2147483001;
    width: min(380px, calc(100vw - 32px)); height: min(600px, calc(100vh - 32px)); display: flex; flex-direction: column; background: var(--nxc-bg);
    border: 1px solid var(--nxc-line); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 50px rgb(0 0 0 / .3); }
  .nxc-panel.nxc-inline { position: static; width: 100%; height: min(720px, calc(100vh - 140px)); min-height: 460px; box-shadow: none; }
  @media (max-width: 480px) { .nxc-panel:not(.nxc-inline) { right: 0; bottom: 0; width: 100vw; height: 100%; border-radius: 0; border: 0; padding-bottom: env(safe-area-inset-bottom, 0px); } }
  .nxc-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--nxc-line); }
  .nxc-av { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--nxc-brand); color: #fff; font-weight: 800; letter-spacing: .02em; }
  .nxc-who { flex: 1; min-width: 0; }
  .nxc-who b { display: block; font-size: 15px; }
  .nxc-who span { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nxc-muted); }
  .nxc-who span::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #1fae5b; }
  .nxc-x { border: 0; background: transparent; color: var(--nxc-muted); font-size: 24px; line-height: 1; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; }
  .nxc-x:hover { background: var(--nxc-soft); }
  .nxc-log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: var(--nxc-soft); overscroll-behavior: contain; }
  .nxc-msg { max-width: 84%; padding: 9px 13px; border-radius: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .nxc-bot { align-self: flex-start; background: var(--nxc-bg); border: 1px solid var(--nxc-line); border-bottom-left-radius: 6px; }
  .nxc-me { align-self: flex-end; background: var(--nxc-brand); color: #fff; border-bottom-right-radius: 6px; }
  .nxc-note { align-self: center; font-size: 11.5px; color: var(--nxc-muted); text-align: center; max-width: 90%; }
  .nxc-pay { align-self: flex-start; display: inline-block; text-decoration: none; background: var(--nxc-brand); color: #fff; font-weight: 700; padding: 11px 16px; border-radius: 12px; }
  .nxc-typing { align-self: flex-start; display: flex; gap: 4px; padding: 12px 14px; background: var(--nxc-bg); border: 1px solid var(--nxc-line); border-radius: 18px; border-bottom-left-radius: 6px; }
  .nxc-typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--nxc-muted); animation: nxc-b 1.2s infinite; }
  .nxc-typing i:nth-child(2) { animation-delay: .15s; } .nxc-typing i:nth-child(3) { animation-delay: .3s; }
  @keyframes nxc-b { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
  @media (prefers-reduced-motion: reduce) { .nxc-typing i { animation: none; opacity: .6; } }
  .nxc-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; background: var(--nxc-soft); }
  .nxc-chip { border: 1px solid var(--nxc-brand); color: var(--nxc-brand); background: var(--nxc-bg); border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 13.5px; cursor: pointer; }
  .nxc-form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--nxc-line); background: var(--nxc-bg); }
  .nxc-in { flex: 1; min-width: 0; resize: none; font: inherit; color: var(--nxc-ink); background: var(--nxc-soft); border: 1px solid var(--nxc-line); border-radius: 20px; padding: 10px 14px; max-height: 120px; }
  .nxc-in:focus { outline: 2px solid var(--nxc-brand); outline-offset: 0; }
  .nxc-send { flex: none; border: 0; border-radius: 50%; width: 42px; height: 42px; background: var(--nxc-brand); color: #fff; font-size: 18px; cursor: pointer; }
  .nxc-send:disabled { opacity: .45; cursor: default; }
  .nxc[hidden], .nxc [hidden] { display: none !important; }
  `;

  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem('nxgs-chat') || 'null'); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem('nxgs-chat', JSON.stringify(v)); } catch (e) {} },
  };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  fetch(API + '/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg.assistant || !cfg.assistant.enabled) {
      if (inline) inline.textContent = 'Chat is not available right now. Please use the booking form.';
      return;
    }
    start(cfg);
  }).catch(function () {});

  function start(cfg) {
    var name = cfg.assistant.name || 'Riley';
    var style = el('style'); style.textContent = css; document.head.appendChild(style);
    var root = el('div', 'nxc');
    var saved = store.get() || {};
    var sessionId = saved.id || null;
    var history = Array.isArray(saved.history) ? saved.history.slice(-40) : [];
    var busy = false;

    var bubble = el('button', 'nxc-bubble');
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Chat with ' + name + ', the NXGS virtual assistant');
    var bav = el('span', 'nxc-av', name[0]);
    bubble.append(bav, el('span', '', 'Plan a party'));

    var panel = el('section', 'nxc-panel' + (inline ? ' nxc-inline' : ''));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with ' + name);
    var head = el('div', 'nxc-head');
    var who = el('div', 'nxc-who');
    who.append(el('b', '', name + ' · NXGS'), el('span', '', 'Virtual assistant · AI'));
    var x = el('button', 'nxc-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close chat');
    head.append(el('div', 'nxc-av', name[0]), who);
    if (!inline) head.append(x);
    var log = el('div', 'nxc-log'); log.setAttribute('aria-live', 'polite');
    var chips = el('div', 'nxc-chips');
    var form = el('form', 'nxc-form');
    var input = el('textarea', 'nxc-in'); input.rows = 1; input.placeholder = 'Type a message…'; input.setAttribute('aria-label', 'Message'); input.maxLength = 1000;
    var send = el('button', 'nxc-send', '➤'); send.type = 'submit'; send.setAttribute('aria-label', 'Send');
    form.append(input, send);
    panel.append(head, log, chips, form);

    if (inline) { inline.textContent = ''; inline.appendChild(root); root.append(panel); }
    else { root.append(bubble, panel); panel.hidden = true; document.body.appendChild(root); }

    function scroll() { log.scrollTop = log.scrollHeight; }
    function addMsg(role, text) {
      var m = el('div', 'nxc-msg ' + (role === 'user' ? 'nxc-me' : 'nxc-bot'), text);
      log.appendChild(m); scroll();
    }
    function addAction(a) {
      if (a.type !== 'checkout') return;
      var link = el('a', 'nxc-pay', a.label + ' →');
      link.href = a.url; link.target = '_top'; link.rel = 'noopener';
      log.appendChild(link);
      log.appendChild(el('div', 'nxc-note', 'Secure checkout · booking ' + a.ref));
      scroll();
    }
    function render() {
      log.textContent = '';
      log.appendChild(el('div', 'nxc-note', 'You’re chatting with ' + name + ', NXGS’s AI assistant. A team member can follow up anytime; just ask.'));
      addMsg('assistant', 'Hi! I’m ' + name + ' 👋 I can check open dates, answer questions about parties at NXGS, and book your party right here. What are you celebrating?');
      history.forEach(function (h) { addMsg(h.role, h.text); (h.actions || []).forEach(addAction); });
      chips.textContent = '';
      chips.hidden = history.length > 0;
      ['Book a birthday party', 'What are the prices?', 'Is this Saturday open?', 'Corporate or team event'].forEach(function (c) {
        var b = el('button', 'nxc-chip', c); b.type = 'button';
        b.onclick = function () { sendMsg(c); };
        chips.appendChild(b);
      });
    }

    function open() { panel.hidden = false; bubble.hidden = true; setTimeout(function () { input.focus(); scroll(); }, 30); }
    function close() { panel.hidden = true; bubble.hidden = false; bubble.focus(); }
    bubble.onclick = open;
    x.onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !inline && !panel.hidden) close(); });

    function sendMsg(text) {
      text = String(text || '').trim();
      if (!text || busy) return;
      busy = true; send.disabled = true; chips.hidden = true;
      history.push({ role: 'user', text: text });
      addMsg('user', text);
      input.value = ''; grow();
      var typing = el('div', 'nxc-typing'); typing.append(el('i'), el('i'), el('i'));
      typing.setAttribute('aria-label', name + ' is typing');
      var startedAt = Date.now();
      setTimeout(function () { if (busy) { log.appendChild(typing); scroll(); } }, 350);
      fetch(API + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId, message: text }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; }); })
        .then(function (d) {
          // A short natural pause so replies don't land before the typing dots appear.
          var wait = Math.max(0, 700 - (Date.now() - startedAt));
          return new Promise(function (res) { setTimeout(function () { res(d); }, wait); });
        })
        .then(function (d) {
          sessionId = d.sessionId;
          typing.remove();
          addMsg('assistant', d.reply);
          (d.actions || []).forEach(addAction);
          history.push({ role: 'assistant', text: d.reply, actions: d.actions || [] });
          store.set({ id: sessionId, history: history.slice(-40) });
        })
        .catch(function (e) {
          typing.remove();
          addMsg('assistant', e.message || 'Sorry, I couldn’t reach the server. Please try again.');
        })
        .then(function () { busy = false; send.disabled = false; input.focus(); });
    }

    function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
    input.addEventListener('input', grow);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(input.value); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); sendMsg(input.value); });

    render();
    if (inline) setTimeout(function () { input.focus(); }, 50);
  }
})();
