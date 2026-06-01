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
      route to the native plugin; onSignOut() clears the stored token.

   Storage: the base URL and bearer token live in @capacitor/preferences (a native
   key store reached over the bridge), NOT localStorage — so injected/3rd-party JS in
   the WebView can't read the token (matters once the live-update channel lands). The
   plugin API is async, so we read it in an async bootstrap and every shimmed fetch
   awaits that bootstrap before it goes out (so the first request already carries the
   base URL + token). On the web (no Preferences plugin) we fall back to localStorage
   so a browser smoke-test still works. */
(function () {
  'use strict';

  var BASE = '';
  var TOKEN = '';
  window.EPOS_API_BASE = '';

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));
  window.EPOS_IS_APP = inApp;

  function prefs() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  // ── Bootstrap: load BASE + TOKEN before any shimmed request goes out ───────────
  // `ready` resolves once BASE/TOKEN are populated. Every shimmed fetch awaits it.
  async function bootstrap() {
    var P = prefs();
    if (!P) {
      // No Preferences plugin (plain browser, or plugin not yet synced) — fall back
      // to localStorage so the staff page is still usable as a browser smoke-test.
      try { BASE = (localStorage.getItem('epos_api_base') || '').replace(/\/+$/, ''); } catch (e) {}
      try { TOKEN = localStorage.getItem('epos_token') || ''; } catch (e) {}
      window.EPOS_API_BASE = BASE;
      return;
    }
    try { var b = await P.get({ key: 'epos_api_base' }); BASE = ((b && b.value) || '').replace(/\/+$/, ''); } catch (e) {}
    try { var t = await P.get({ key: 'epos_token' }); TOKEN = (t && t.value) || ''; } catch (e) {}

    // One-time migration off plain localStorage (the scaffold used to store here):
    // move any legacy values into Preferences, then wipe the JS-readable copies.
    try {
      var lb = localStorage.getItem('epos_api_base');
      var lt = localStorage.getItem('epos_token');
      if (!BASE && lb) { BASE = lb.replace(/\/+$/, ''); await P.set({ key: 'epos_api_base', value: BASE }); }
      if (!TOKEN && lt) { TOKEN = lt; await P.set({ key: 'epos_token', value: TOKEN }); }
      if (lb != null) localStorage.removeItem('epos_api_base');
      if (lt != null) localStorage.removeItem('epos_token');
    } catch (e) {}

    window.EPOS_API_BASE = BASE;
  }

  var ready = bootstrap();

  // ── Fetch shim ─────────────────────────────────────────────────────────────────
  // Build an explicit RequestInit from a Request object. We must NOT pass the Request
  // itself as the init arg of fetch()/new Request() (P2-13): strict/older WebViews —
  // like the T2's — can drop its body or headers. The body is read out separately
  // (async) for methods that carry one.
  function initFromRequest(req, headers) {
    return {
      method: req.method,
      headers: headers,
      mode: req.mode,
      credentials: req.credentials,
      cache: req.cache,
      redirect: req.redirect,
      referrer: req.referrer,
      referrerPolicy: req.referrerPolicy,
      integrity: req.integrity,
      keepalive: req.keepalive,
      signal: req.signal
    };
  }

  function captureToken(res) {
    // Capture the session token from a successful login and persist it. We await the
    // Preferences write before resolving so a reload right after login keeps the token;
    // the in-memory TOKEN is set first so the page's very next request already carries it.
    if (!res || !res.ok) return res;
    return res.clone().json().then(function (d) {
      if (d && d.token) {
        TOKEN = d.token;
        var P = prefs();
        if (P) return P.set({ key: 'epos_token', value: TOKEN }).then(function () { return res; }, function () { return res; });
      }
      return res;
    }, function () { return res; });
  }

  function doFetch(_fetch, input, init) {
    init = init || {};
    var isReq = (typeof input !== 'string') && input && typeof input.url === 'string';
    var url = isReq ? input.url : String(input);

    // (a) rewrite relative -> provisioned backend
    if (BASE && url.charAt(0) === '/') url = BASE + url;

    // (b,c) app marker + bearer token. Explicit init.headers win over a Request's own.
    var headers = new Headers(init.headers || (isReq ? input.headers : undefined) || {});
    headers.set('X-Client', 'app');
    if (TOKEN) headers.set('Authorization', 'Bearer ' + TOKEN);

    var p;
    if (isReq) {
      var reqInit = initFromRequest(input, headers);
      for (var k in init) { if (k !== 'headers' && Object.prototype.hasOwnProperty.call(init, k) && init[k] !== undefined) reqInit[k] = init[k]; }
      var method = (reqInit.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        p = input.clone().arrayBuffer().then(function (buf) {
          if (buf && buf.byteLength) reqInit.body = buf;
          return _fetch(url, reqInit);
        });
      } else {
        p = _fetch(url, reqInit);
      }
    } else {
      p = _fetch(url, Object.assign({}, init, { headers: headers }));
    }

    // (3) capture the token from login — await it so the page's next requests
    // already carry the token (avoids a first-call 401 race).
    if (url.indexOf('/api/staff/login') !== -1) return p.then(captureToken);
    return p;
  }

  // Install our wrapper as window.fetch. CapacitorHttp (capacitor.config.json) also
  // patches window.fetch to proxy requests natively (no CORS). Ordering matters
  // (P2-14): our wrapper must sit OUTSIDE CapacitorHttp's so the headers we inject are
  // handed to it. The bridge normally patches first (we then wrap it), but to be robust
  // if CapacitorHttp patches *after* us — which would bypass our headers — we re-assert
  // on DOMContentLoaded. installFetchShim() is idempotent: it no-ops if we're already
  // the outermost wrapper, otherwise it wraps whatever fetch is current. On-device check:
  // log in and confirm the request carries Authorization + X-Client (a 200, not a 401).
  function installFetchShim() {
    if (!inApp || typeof window.fetch !== 'function') return;
    if (window.__eposFetch && window.fetch === window.__eposFetch) return; // already ours
    var _fetch = window.fetch.bind(window);
    var wrapper = function (input, init) {
      return ready.then(function () { return doFetch(_fetch, input, init); });
    };
    window.__eposFetch = wrapper;
    window.fetch = wrapper;
  }

  installFetchShim();
  if (inApp && document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installFetchShim);
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
    // token so the app truly signs out — keeps the device's shop provisioning. The
    // in-memory token is cleared synchronously; the Preferences wipe is best-effort.
    onSignOut: function () {
      TOKEN = '';
      var P = prefs();
      if (P) { try { P.remove({ key: 'epos_token' }); } catch (e) {} }
      try { localStorage.removeItem('epos_token'); } catch (e) {}
    }
  };

  function onReady(fn) {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // Per-shop assets the staff page loads through the HTML parser — e.g.
  // <img src="/logo.png"> — bypass the fetch shim, so we can't tag/route them there.
  // Point them at the provisioned backend so one APK shows each device's own shop
  // logo (the shared app code IS bundled locally; only per-shop assets come from BASE).
  function rewriteParserAssets() {
    if (!BASE) return;
    var imgs = document.querySelectorAll('img[src^="/"]');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src');
      if (src && src.charAt(0) === '/' && src.charAt(1) !== '/') imgs[i].src = BASE + src;
    }
  }

  if (inApp) {
    ready.then(function () {
      onReady(rewriteParserAssets);
      // First run with no shop set → show the provisioning screen (after the async
      // bootstrap has had its chance to load a previously-saved base URL).
      if (!BASE) onReady(function () { if (window.EPOSProvision) window.EPOSProvision.show(); });
    });
  }
})();
