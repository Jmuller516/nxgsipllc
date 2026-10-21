/*
 * NXGS booking embed. Paste this on any page (WordPress, Base44, etc.):
 *
 *   <div id="nxgs-booking"></div>
 *   <script src="https://book.nxgs.net/static/embed.js" async></script>
 *
 * Optional on the div:
 *   data-page="calendar"  shows the live availability calendar instead of the booking form
 *   data-tab="inquiry"    opens the group & corporate form first
 * The frame grows and shrinks to fit the booking form, so there is no inner scrollbar.
 */
(function () {
  var script = document.currentScript;
  var origin = new URL(script.src).origin;
  function mount() {
    var host = document.getElementById('nxgs-booking');
    if (!host || host.dataset.mounted) return;
    host.dataset.mounted = '1';
    var frame = document.createElement('iframe');
    var tab = host.getAttribute('data-tab');
    var page = host.getAttribute('data-page') === 'calendar' ? '/calendar' : '/book';
    frame.src = origin + page + '?embed=1' + (tab ? '&tab=' + encodeURIComponent(tab) : '');
    frame.title = 'Book a party';
    frame.loading = 'lazy';
    frame.style.cssText = 'width:100%;border:0;display:block;min-height:900px;transition:height .15s';
    frame.setAttribute('allow', 'payment');
    host.appendChild(frame);
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || !e.data || e.data.type !== 'nxgs:height') return;
      frame.style.minHeight = '0';
      frame.style.height = Math.ceil(e.data.height) + 'px';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
