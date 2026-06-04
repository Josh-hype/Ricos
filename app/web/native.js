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

   FAIL-SAFE (added after on-device debugging on the Sunmi T2s):
   - bootstrap() reads stored settings over the Capacitor bridge; that read is raced
     against a timeout so a stalled bridge can NEVER freeze the whole app.
   - Until the till is provisioned (no BASE), relative `/api/...` calls are REJECTED
     (not sent to the local app origin, which used to fail-open the login + stall the
     menu) and the "Set up this till" screen is forced.
   - Every shimmed request has a timeout, so a dead backend shows a clear error instead
     of an infinite "Loading menu…".
   - A small on-screen diagnostic surfaces JS errors / "not running as the app" — the
     till has no remote console (USB debugging is locked), so this is how we see faults. */
(function () {
  'use strict';

  var BUILD = 'failsafe-31'; // bump on each app-layer change so the device log confirms freshness

  var BASE = '';
  var TOKEN = '';
  window.EPOS_API_BASE = '';

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));
  window.EPOS_IS_APP = inApp;
  try { console.log('[native] BUILD ' + BUILD + ' · inApp=' + inApp + ' · Capacitor=' + (typeof window.Capacitor) + ' · Preferences=' + (!!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences))); } catch (e) {}

  // ── On-screen diagnostic (no remote console on the locked-down till) ─────────────
  function diag(msg) {
    try {
      var el = document.getElementById('eposDiag');
      if (!el) {
        el = document.createElement('div');
        el.id = 'eposDiag';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
          'background:#7a1020;color:#fff;font:12px/1.45 -apple-system,system-ui,monospace;' +
          'padding:7px 12px;white-space:pre-wrap;max-height:42%;overflow:auto';
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = 'LumiPOS diag — ' + msg;
    } catch (e) {}
  }
  try {
    window.addEventListener('error', function (e) {
      diag('error: ' + ((e && e.message) || e) + '  @' + ((e && e.filename) || '?') + ':' + ((e && e.lineno) || '?'));
    });
  } catch (e) {}

  function prefs() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  // ── Bootstrap: load BASE + TOKEN before any shimmed request goes out ───────────
  async function bootstrap() {
    var P = prefs();
    if (!P) {
      try { BASE = (localStorage.getItem('epos_api_base') || '').replace(/\/+$/, ''); } catch (e) {}
      try { TOKEN = localStorage.getItem('epos_token') || ''; } catch (e) {}
      window.EPOS_API_BASE = BASE;
      return;
    }
    try { var b = await P.get({ key: 'epos_api_base' }); BASE = ((b && b.value) || '').replace(/\/+$/, ''); } catch (e) {}
    try { var t = await P.get({ key: 'epos_token' }); TOKEN = (t && t.value) || ''; } catch (e) {}
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

  // `ready` ALWAYS settles: a stalled Preferences bridge read can't freeze the app
  // (which would block every fetch AND the provisioning screen). 2s is plenty on-device.
  var ready = Promise.race([
    bootstrap(),
    new Promise(function (resolve) { setTimeout(resolve, 2000); })
  ]);

  // ── Provisioning trigger (idempotent; provision.js no-ops if already shown) ──────
  function showProvisioning() {
    if (!inApp) return;
    var go = function () {
      if (window.EPOSProvision) window.EPOSProvision.show();
      else diag('setup screen unavailable (provision.js not loaded)');
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', go);
    else go();
  }

  // Reject a hung request after `ms` so the staff page shows a clear error instead of
  // spinning forever (the underlying native request may still finish; that's fine).
  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Request timed out — check the connection.')); }, ms);
      })
    ]);
  }

  // ── Fetch shim ─────────────────────────────────────────────────────────────────
  function initFromRequest(req, headers) {
    return {
      method: req.method, headers: headers, mode: req.mode, credentials: req.credentials,
      cache: req.cache, redirect: req.redirect, referrer: req.referrer,
      referrerPolicy: req.referrerPolicy, integrity: req.integrity,
      keepalive: req.keepalive, signal: req.signal
    };
  }

  function captureToken(res) {
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

    // FAIL SAFE: not provisioned yet → don't let the staff page's relative `/api/...`
    // calls hit the local app origin (that fail-opened login + stalled the menu).
    // Force the setup screen and reject clearly so the page shows "not connected".
    if (!BASE && url.charAt(0) === '/' && url.charAt(1) !== '/') {
      try { console.log('[native] no BASE → rejecting ' + url + ' + forcing setup'); } catch (e) {}
      showProvisioning();
      return Promise.reject(new Error('This till isn’t set up yet — finish "Set up this till".'));
    }

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

    p = withTimeout(p, 12000); // no infinite "Loading menu…" on a dead/slow backend

    // (3) capture the token from login — await it so the page's next requests carry it.
    if (url.indexOf('/api/staff/login') !== -1) return p.then(captureToken);
    return p;
  }

  // Install our wrapper as window.fetch, OUTSIDE CapacitorHttp's patch (P2-14). The
  // bridge normally patches first (we wrap it); we re-assert on DOMContentLoaded in
  // case it patches after us. Idempotent.
  function installFetchShim() {
    if (!inApp || typeof window.fetch !== 'function') return;
    if (window.__eposFetch && window.fetch === window.__eposFetch) return;
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

  // Hardware facade. Resolve the native plugin DIRECTLY each call (not via the shim's
  // cached `available`): an older/eager shim could pin available=false forever and make
  // the printer look "not-in-app" even though the plugin is wired. This can't.
  function eposPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EposHardware) || null;
  }
  window.EPOSNative = {
    isApp: inApp,
    // Guard each method: an OLD native plugin (built before printDoc) won't expose it,
    // so we return not-in-app rather than throw — printTo then falls back to text.
    printDoc: function (payload) {
      var p = eposPlugin(); if (p && p.printDoc) return p.printDoc(payload || {});
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
    printReceipt: function (payload) {
      var p = eposPlugin(); if (p && p.printReceipt) return p.printReceipt(payload || {});
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
    kickDrawer: function () {
      var p = eposPlugin(); if (p && p.kickDrawer) return p.kickDrawer();
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
    collectCardPayment: function (payload) {
      var p = eposPlugin(); if (p && p.collectCardPayment) return p.collectCardPayment(payload || {});
      return Promise.resolve({ ok: false, reason: 'not-in-app' });
    },
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

  // Per-shop assets the staff page loads through the HTML parser (e.g. <img src="/logo.png">)
  // bypass the fetch shim — point them at the provisioned backend.
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
      try { console.log('[native] bootstrap done · BASE=' + (BASE || '(empty)') + ' · EPOSProvision=' + (typeof window.EPOSProvision)); } catch (e) {}
      // Tell Capgo this OTA bundle booted OK — without this, the updater auto-reverts to
      // the previous good bundle after a few seconds (the safety net for a bad update).
      try {
        var cu = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater;
        if (cu && cu.notifyAppReady) { cu.notifyAppReady(); console.log('[native] OTA notifyAppReady · updater present'); }
        else console.log('[native] OTA updater not present (will be after next rebuild)');
      } catch (e) {}
      onReady(rewriteParserAssets);
      if (!BASE) { try { console.log('[native] no BASE on boot → showProvisioning'); } catch (e) {} showProvisioning(); } // first run → set up this till
    });
  } else {
    // Not detected as the native app — make it visible instead of a silently-broken screen.
    try { console.log('[native] inApp=false → not wrapping fetch / no provisioning'); } catch (e) {}
    onReady(function () { diag('not running as the app (Capacitor bridge not detected). Open the LumiPOS app, not a browser tab.'); });
  }
})();

/* ── Flex-gap polyfill ────────────────────────────────────────────────────────────
   The Sunmi T2's WebView supports CSS Grid `gap` but NOT flex `gap` (added in Chrome
   84), so the staff page's many flex rows/columns render with no spacing. Feature-test
   once; where flex gap is missing, mirror each flex container's gap as margins on its
   children, and re-apply as content renders. No-op on modern browsers — so the CSS keeps
   using real `gap` there, and there's no double spacing anywhere. */
(function () {
  'use strict';
  function gapWorks() {
    try {
      var d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:10px;position:absolute;left:-9999px;top:-9999px;visibility:hidden';
      var a = document.createElement('div'), b = document.createElement('div');
      a.style.cssText = b.style.cssText = 'width:10px;height:1px;flex:none';
      d.appendChild(a); d.appendChild(b);
      (document.body || document.documentElement).appendChild(d);
      var ok = d.scrollWidth >= 25; // 10 + 10 + a 10px gap = 30 if it renders, 20 if not
      d.parentNode.removeChild(d);
      return ok;
    } catch (e) { return true; } // on any error assume supported — never break a good browser
  }
  if (gapWorks()) return;
  try { console.log('[native] flex-gap polyfill active (legacy WebView)'); } catch (e) {}

  function px(v) { var n = parseFloat(v); return n > 0 ? n : 0; }
  function setM(ch, prop, val) { if (ch.style[prop] !== val) ch.style[prop] = val; }
  function fixOne(el) {
    if (!el || el.nodeType !== 1 || !el.style) return;
    var cs = window.getComputedStyle(el), disp = cs.display;
    if (disp !== 'flex' && disp !== 'inline-flex') return;
    var colGap = px(cs.columnGap), rowGap = px(cs.rowGap);
    if (!colGap && !rowGap) return;
    var column = (cs.flexDirection || 'row').indexOf('column') === 0;
    var wrap = (cs.flexWrap || 'nowrap').indexOf('wrap') === 0;
    var kids = el.children, first = true;
    for (var k = 0; k < kids.length; k++) {
      var ch = kids[k];
      if (ch.nodeType !== 1 || !ch.style) continue;
      if (wrap) { // wrapping rows: space both ways (a little trailing margin is harmless)
        if (colGap) setM(ch, 'marginRight', colGap + 'px');
        if (rowGap) setM(ch, 'marginBottom', rowGap + 'px');
      } else if (first) { first = false; } // first child gets no leading gap
      else if (column) { setM(ch, 'marginTop', rowGap + 'px'); }
      else { setM(ch, 'marginLeft', colGap + 'px'); }
    }
  }
  function run() {
    var els = document.getElementsByTagName('*');
    for (var i = 0; i < els.length; i++) { try { fixOne(els[i]); } catch (e) {} }
  }
  var t;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) { clearTimeout(t); t = setTimeout(run, 80); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
