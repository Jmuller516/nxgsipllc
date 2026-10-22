/* NXGS waiver form with a finger/mouse signature pad.
 * NXWaiver.mount(container, { inviteToken, prefill: {childName, guardianName, guardianEmail, guardianPhone, medicalNotes}, onDone(result) })
 */
(function () {
  var T = window.NXI18N ? NXI18N.t : function (k) { return k; };
  var LANG = window.NXI18N ? NXI18N.lang : 'en';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mount(el, opts) {
    opts = opts || {};
    var p = opts.prefill || {};
    var uid = 'w' + Math.random().toString(36).slice(2, 8);
    el.innerHTML = '<p class="muted">' + esc(T('loadingWaiver')) + '</p>';
    fetch('/api/waiver?lang=' + LANG).then(function (r) { return r.json(); }).then(function (w) {
      el.innerHTML =
        '<form class="waiver" novalidate>' +
        (w.isSample ? '<p class="banner">' + esc(T('sampleWaiver')) + '</p>' : '') +
        (w.translationMissing && T('waiverEnglishOnly') ? '<p class="muted">' + esc(T('waiverEnglishOnly')) + '</p>' : '') +
        '<h3 class="waiver-title">' + esc(w.title) + '</h3>' +
        '<div class="waiver-text" tabindex="0">' + w.text.split(/\n\n+/).map(function (para) { return '<p>' + esc(para) + '</p>'; }).join('') + '</div>' +
        '<div class="row"><div><label for="' + uid + 'c">' + esc(T('childFull')) + '</label><input id="' + uid + 'c" name="childName" autocomplete="off" value="' + esc(p.childName) + '"></div>' +
        '<div><label for="' + uid + 'b">' + esc(T('birthDate')) + ' <span class="muted">' + esc(T('optional')) + '</span></label><input id="' + uid + 'b" name="childBirthdate" type="date"></div></div>' +
        '<div class="row"><div><label for="' + uid + 'g">' + esc(T('guardianFull')) + '</label><input id="' + uid + 'g" name="guardianName" autocomplete="name" value="' + esc(p.guardianName) + '"></div>' +
        '<div><label for="' + uid + 'e">' + esc(T('email')) + '</label><input id="' + uid + 'e" name="guardianEmail" type="email" autocomplete="email" value="' + esc(p.guardianEmail) + '"></div></div>' +
        '<div class="row"><div><label for="' + uid + 'p">' + esc(T('phone')) + '</label><input id="' + uid + 'p" name="guardianPhone" type="tel" autocomplete="tel" value="' + esc(p.guardianPhone) + '"></div>' +
        '<div><label for="' + uid + 'en">' + esc(T('emergency')) + ' <span class="muted">' + esc(T('emergencyHint')) + '</span></label><input id="' + uid + 'en" name="emergency" placeholder="Chris Rivera, 516-555-0102"></div></div>' +
        '<label for="' + uid + 'm">' + esc(T('medical')) + ' <span class="muted">' + esc(T('allergiesOrHint')) + '</span></label><textarea id="' + uid + 'm" name="medicalNotes" rows="2">' + esc(p.medicalNotes) + '</textarea>' +
        '<label class="check"><input type="checkbox" name="agree"> ' + esc(T('agree')) + '</label>' +
        '<label>' + esc(T('signBelow')) + '</label>' +
        '<div class="sig-wrap"><canvas class="sig" aria-label="Signature pad"></canvas><button type="button" class="btn ghost small sig-clear">' + esc(T('clear')) + '</button></div>' +
        '<label for="' + uid + 't">' + esc(T('typeName')) + '</label><input id="' + uid + 't" name="typedSignature" autocomplete="off">' +
        (opts.hideOptIn ? '' : '<label class="check"><input type="checkbox" name="marketingOptIn"> ' + esc(T('marketingOptIn')) + '</label>') +
        '<div class="error hidden" role="alert"></div>' +
        '<div class="actions"><button class="btn" type="submit">' + esc(T('signWaiver')) + '</button></div>' +
        '<p class="muted small">' + esc(T('validFor', Math.round(w.validDays / 30.4), new Date().toLocaleDateString(window.NXI18N ? NXI18N.locale : undefined), w.version)) + '</p>' +
        '</form>';
      wire(el.querySelector('form'), opts);
    }).catch(function () { el.innerHTML = '<p class="error">' + esc(T('waiverNoLoad')) + '</p>'; });
  }

  function wire(form, opts) {
    var canvas = form.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    var drawn = 0, last = null;
    function size() {
      var r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      var keep = drawn ? canvas.toDataURL() : null;
      canvas.width = Math.max(1, r.width * d); canvas.height = Math.max(1, r.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f1b2d';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, r.width, r.height);
      if (keep) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, r.width, r.height); }; img.src = keep; }
    }
    size();
    window.addEventListener('resize', size);
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1, 0, Math.PI * 2); ctx.fillStyle = '#0f1b2d'; ctx.fill(); drawn++; });
    canvas.addEventListener('pointermove', function (e) { if (!last) return; var q = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke(); last = q; drawn++; });
    function end() { last = null; }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
    form.querySelector('.sig-clear').onclick = function () { drawn = 0; size(); };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = form.querySelector('.error');
      err.classList.add('hidden');
      var f = form.elements;
      var emergency = f.emergency.value.trim();
      var em = /^(.*?)[,;]?\s*([+()\d][\d\s().-]{6,})$/.exec(emergency);
      var body = {
        inviteToken: opts.inviteToken || null,
        childName: f.childName.value, childBirthdate: f.childBirthdate.value || null,
        guardianName: f.guardianName.value, guardianEmail: f.guardianEmail.value, guardianPhone: f.guardianPhone.value,
        emergencyName: em ? em[1].trim() : emergency, emergencyPhone: em ? em[2].trim() : null,
        medicalNotes: f.medicalNotes.value, agree: f.agree.checked, lang: LANG,
        marketingOptIn: !!(opts.hideOptIn || (f.marketingOptIn && f.marketingOptIn.checked)),
        typedSignature: f.typedSignature.value,
        signature: drawn > 3 ? canvas.toDataURL('image/png') : null,
      };
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = T('signing');
      fetch('/api/waivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || T('saveFailed')); return d; }); })
        .then(function (d) { if (opts.onDone) opts.onDone(d); })
        .catch(function (x) { err.textContent = x.message; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = T('signWaiver'); });
    });
  }

  window.NXWaiver = { mount: mount };
})();
