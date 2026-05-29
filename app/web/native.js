/* native.js — loaded BEFORE the staff EPOS script inside the app build.
   Three jobs, all no-ops on a plain web browser so the same staff page keeps
   working unchanged on Cloudflare:

   1. API base — read the provisioned shop's backend origin and expose it as
      window.EPOS_API_BASE.
   2. Transparent request rewriting — the staff page uses relative URLs
      (`/api/...`, `/menu-visual.json`, `/logo.png`); when running in the app we
      prefix them with the provisioned origin so we DON'T have to edit the
      3,000-line staff template. (Cross-origin auth is an open decision — see
      docs/PHASE2_APP.md. Until token auth lands, use the server.url quick-run
      mode in app/README.md for on-device testing.)
   3. Hardware facade — window.EPOSNative.{printReceipt,kickDrawer,
      collectCardPayment} routes to the native plugin in the app, no-ops on web. */
(function () {
  'use strict';

  var BASE = '';
  try { BASE = (localStorage.getItem('epos_api_base') || '').replace(/\/+$/, ''); } catch (e) {}
  window.EPOS_API_BASE = BASE;

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));
  window.EPOS_IS_APP = inApp;

  // 2. Rewrite same-origin-style relative requests to the provisioned backend.
  if (inApp && BASE && typeof window.fetch === 'function') {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' && input.charAt(0) === '/') {
          input = BASE + input;
          init = Object.assign({ credentials: 'include' }, init || {});
        } else if (input instanceof Request && input.url && input.url.indexOf('/') === 0) {
          input = new Request(BASE + input.url, input);
        }
      } catch (e) { /* fall through with the original args */ }
      return _fetch(input, init);
    };
  }

  // 3. Hardware facade. window.EposHardware (the plugin proxy) is defined by
  //    plugins/epos-hardware.js; here we wrap it with friendly no-op fallbacks.
  window.EPOSNative = {
    isApp: inApp,
    printReceipt: function (payload) {
      if (window.EposHardware && window.EposHardware.available) return window.EposHardware.printReceipt(payload || {});
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
    kickDrawer: function () {
      if (window.EposHardware && window.EposHardware.available) return window.EposHardware.kickDrawer();
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
    collectCardPayment: function (payload) {
      if (window.EposHardware && window.EposHardware.available) return window.EposHardware.collectCardPayment(payload || {});
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    }
  };

  // First run in the app with no shop set → show the provisioning screen.
  if (inApp && !BASE) {
    window.addEventListener('DOMContentLoaded', function () {
      if (window.EPOSProvision) window.EPOSProvision.show();
    });
  }
})();
