/* native.js — loaded BEFORE the staff EPOS script inside the app build. No-ops on
   a plain web browser, so the same staff page keeps working unchanged on Cloudflare.

   Jobs:
   1. API base — read the provisioned shop's backend origin (window.EPOS_API_BASE).
   2. Request shim — the staff page uses relative URLs (`/api/...`, `/menu-visual.json`,
      `/logo.png`); in the app we (a) rewrite them to the provisioned origin so we
      DON'T edit the 3,000-line staff template, (b) tag them `X-Client: app`, and
      (c) attach the Bearer session token. Cross-origin works because CapacitorHttp
      proxies requests natively (no browser CORS) — see capacitor.config.json.
   3. Token capture — grab the session token from a successful /api/staff/login and
      store it; attach it as Authorization on every later request.
   4. Hardware facade — window.EPOSNative.{printReceipt,kickDrawer,collectCardPayment}
      route to the native plugin; onSignOut() clears the stored token. */
(function () {
  'use strict';

  var BASE = '';
  var TOKEN = '';
  try { BASE = (localStorage.getItem('epos_api_base') || '').replace(/\/+$/, ''); } catch (e) {}
  try { TOKEN = localStorage.getItem('epos_token') || ''; } catch (e) {}
  window.EPOS_API_BASE = BASE;

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));
  window.EPOS_IS_APP = inApp;

  if (inApp && typeof window.fetch === 'function') {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      var isReq = (typeof input !== 'string') && input && typeof input.url === 'string';
      var url = isReq ? input.url : String(input);

      // (a) rewrite relative -> provisioned backend
      if (BASE && url.charAt(0) === '/') {
        url = BASE + url;
        input = isReq ? new Request(url, input) : url;
      }

      // (b,c) app marker + bearer token
      var headers = new Headers(init.headers || (isReq ? input.headers : undefined) || {});
      headers.set('X-Client', 'app');
      if (TOKEN) headers.set('Authorization', 'Bearer ' + TOKEN);
      init = Object.assign({}, init, { headers: headers });

      var p = _fetch(input, init);

      // (3) capture the token from login — await it so the page's next requests
      // already carry the token (avoids a first-call 401 race).
      if (url.indexOf('/api/staff/login') !== -1) {
        return p.then(async function (res) {
          try {
            if (res.ok) {
              var d = await res.clone().json();
              if (d && d.token) { TOKEN = d.token; try { localStorage.setItem('epos_token', TOKEN); } catch (e) {} }
            }
          } catch (e) {}
          return res;
        });
      }
      return p;
    };
  }

  // Hardware facade. window.EposHardware (the plugin proxy) is defined by
  // plugins/epos-hardware.js; here we wrap it with friendly no-op fallbacks.
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
    },
    // Called by the staff page's sign-out (and switch-operator). Drops the stored
    // token so the app truly signs out — keeps the device's shop provisioning.
    onSignOut: function () {
      TOKEN = '';
      try { localStorage.removeItem('epos_token'); } catch (e) {}
    }
  };

  // First run in the app with no shop set → show the provisioning screen.
  if (inApp && !BASE) {
    window.addEventListener('DOMContentLoaded', function () {
      if (window.EPOSProvision) window.EPOSProvision.show();
    });
  }
})();
