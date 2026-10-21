/* NXGS sponsor strip: "Presented by" logos for a page.
 * NXSponsors.mount(element, placement, locationId)
 */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mount(el, placement, locationId) {
    if (!el) return;
    fetch('/api/sponsors?placement=' + encodeURIComponent(placement) + (locationId ? '&location=' + encodeURIComponent(locationId) : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.sponsors) || [];
        if (!list.length) { el.innerHTML = ''; return; }
        el.innerHTML = '<div class="sponsor-strip"><span class="sponsor-label">' + (list.length > 1 ? 'Parties presented by' : 'Presented by') + '</span>' +
          list.map(function (s) {
            var inner = s.logo ? '<img src="' + esc(s.logo) + '" alt="' + esc(s.name) + '">' : '<b>' + esc(s.name) + '</b>';
            var tag = s.tagline ? '<small>' + esc(s.tagline) + '</small>' : '';
            return s.hasLink ? '<a class="sponsor" href="/s/' + s.id + '" target="_blank" rel="sponsored noopener">' + inner + tag + '</a>' : '<span class="sponsor">' + inner + tag + '</span>';
          }).join('') + '</div>';
      }).catch(function () { el.innerHTML = ''; });
  }
  window.NXSponsors = { mount: mount };
})();
