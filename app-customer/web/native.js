/* native.js — customer-app shim, loaded BEFORE the order page's scripts inside
   the app bundle (after app-base.js, which bakes window.LUMIN_APP_CONFIG).
   Adapted from the till's app/web/native.js; no-ops in a plain browser so the
   same built page keeps working on the website unchanged.

   Jobs:
   1. App marker — window.LUMIN_APP = { base, slug, platform } + an `app-mode`
      class on <html>, set synchronously so the page's own scripts and CSS can
      gate on them (hide website chrome, skip Apple Pay/Google Pay, etc.).
   2. Request shim — the order page uses relative URLs (`/api/...`,
      `/menu-visual.json`); rewrite them to the shop's baked origin, tag them
      `X-Client: app`, attach the customer Bearer token. Cross-origin works
      because CapacitorHttp proxies natively (no browser CORS) — see
      capacitor.config.template.json.
   3. Token capture — grab the session token from a successful
      /api/account/signin|signup|reset-password and persist it (Capacitor
      Preferences, NOT localStorage); clear it on signout / account delete.
   4. Order capture — persist { orderId, statusToken } from POST /api/order to
      localStorage `<slug>.lastOrder` so the thank-you screen can poll
      /api/order/:id/status, and silently attach the cached push device token
      to order bodies once the customer has enabled notifications.
   5. External links — anything that leaves the ordering flow (socials, legal
      pages, the website itself) opens in the system browser, not the shell.

   FAIL-SAFES (inherited from the till after on-device debugging):
   - The Preferences bootstrap read is raced against a 2s timeout — a stalled
     bridge can never freeze the app (BASE is baked, so requests still work).
   - Every shimmed request has a 12s timeout: a dead backend shows the page's
     own error handling instead of an infinite "Loading menu…". */
(function () {
  'use strict';

  var BUILD = 'customer-1'; // bump on each app-layer change so device logs confirm freshness

  var CFG = window.LUMIN_APP_CONFIG || {};
  var BASE = String(CFG.base || '').replace(/\/+$/, '');
  var SLUG = CFG.slug || '';
  var TOKEN = '';
  var PUSH_TOKEN = '';
  var PUSH_PLATFORM = '';

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));

  var platform = 'web';
  try {
    platform = (window.Capacitor && typeof window.Capacitor.getPlatform === 'function')
      ? window.Capacitor.getPlatform() : 'web';
  } catch (e) {}

  if (inApp) {
    window.LUMIN_APP = { base: BASE, slug: SLUG, platform: platform, shortName: CFG.shortName || '' };
    try { document.documentElement.classList.add('app-mode'); } catch (e) {}
  }
  try { console.log('[app] BUILD ' + BUILD + ' · inApp=' + inApp + ' · base=' + BASE + ' · slug=' + SLUG); } catch (e) {}

  function prefs() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  // ── Bootstrap: load the persisted session + push tokens ────────────────────
  async function bootstrap() {
    var P = prefs();
    if (!P) return;
    try { var t = await P.get({ key: 'cust_token' }); TOKEN = (t && t.value) || ''; } catch (e) {}
    try { var pt = await P.get({ key: 'push_token' }); PUSH_TOKEN = (pt && pt.value) || ''; } catch (e) {}
    try { var pp = await P.get({ key: 'push_platform' }); PUSH_PLATFORM = (pp && pp.value) || ''; } catch (e) {}
  }
  var ready = Promise.race([
    bootstrap(),
    new Promise(function (resolve) { setTimeout(resolve, 2000); })
  ]);

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Request timed out — check your connection.')); }, ms);
      })
    ]);
  }

  function setToken(value) {
    TOKEN = value || '';
    var P = prefs();
    if (P) {
      try {
        if (TOKEN) P.set({ key: 'cust_token', value: TOKEN });
        else P.remove({ key: 'cust_token' });
      } catch (e) {}
    }
  }

  // Called by push.js once the device token exists, so later orders carry it.
  window.__luminSetPushToken = function (token, plat) {
    PUSH_TOKEN = token || '';
    PUSH_PLATFORM = plat || platform;
    var P = prefs();
    if (P && PUSH_TOKEN) {
      try {
        P.set({ key: 'push_token', value: PUSH_TOKEN });
        P.set({ key: 'push_platform', value: PUSH_PLATFORM });
      } catch (e) {}
    }
  };

  // ── Response captures ──────────────────────────────────────────────────────
  function captureAuth(res) {
    if (!res || !res.ok) return res;
    return res.clone().json().then(function (d) {
      if (d && d.token) setToken(d.token);
      return res;
    }, function () { return res; });
  }
  function captureOrder(res) {
    if (!res || !res.ok) return res;
    return res.clone().json().then(function (d) {
      if (d && d.orderId && d.statusToken) {
        // localStorage (not Preferences): the thank-you page reads it
        // synchronously on load, same WebView origin. Nothing sensitive —
        // the statusToken only reveals order lifecycle state.
        try {
          localStorage.setItem(SLUG + '.lastOrder', JSON.stringify({
            orderId: d.orderId,
            orderNumber: d.orderNumber || null,
            statusToken: d.statusToken,
            at: Date.now(),
          }));
        } catch (e) {}
      }
      return res;
    }, function () { return res; });
  }

  // ── Fetch shim ─────────────────────────────────────────────────────────────
  function initFromRequest(req, headers) {
    return {
      method: req.method, headers: headers, mode: req.mode, credentials: req.credentials,
      cache: req.cache, redirect: req.redirect, referrer: req.referrer,
      referrerPolicy: req.referrerPolicy, integrity: req.integrity,
      keepalive: req.keepalive, signal: req.signal
    };
  }

  // Attach the cached push device token to an order being placed, so repeat
  // orders get status pushes without re-asking anything. First-ever order gets
  // its token via POST /api/order/:id/push from the thank-you screen instead.
  function withPushToken(bodyText) {
    if (!PUSH_TOKEN) return bodyText;
    try {
      var body = JSON.parse(bodyText);
      if (body && typeof body === 'object' && !body.push) {
        body.push = { token: PUSH_TOKEN, platform: PUSH_PLATFORM || platform };
        return JSON.stringify(body);
      }
    } catch (e) {}
    return bodyText;
  }

  function doFetch(_fetch, input, init) {
    init = init || {};
    var isReq = (typeof input !== 'string') && input && typeof input.url === 'string';
    var url = isReq ? input.url : String(input);
    var pathOnly = url.charAt(0) === '/' && url.charAt(1) !== '/' ? url : '';

    // Only SHOP-BOUND requests are shimmed. Third-party calls (Stripe.js
    // talking to api.stripe.com from the page context, Google Fonts, …) pass
    // through untouched — injecting our Authorization header there would
    // clobber Stripe's own auth and leak the session token. (The till's shim
    // tags everything, but every till request is shop-bound; here it isn't.)
    var isOurs = !!pathOnly || (BASE && (url === BASE || url.indexOf(BASE + '/') === 0));
    if (!isOurs) return _fetch(input, init);

    // (2) rewrite relative -> baked shop origin
    if (BASE && pathOnly) url = BASE + url;

    var headers = new Headers(init.headers || (isReq ? input.headers : undefined) || {});
    headers.set('X-Client', 'app');
    if (TOKEN) headers.set('Authorization', 'Bearer ' + TOKEN);

    var method = ((isReq ? input.method : init.method) || 'GET').toUpperCase();
    var isOrderPost = method === 'POST' && /\/api\/order$/.test(url.split('?')[0]);

    var p;
    if (isReq) {
      var reqInit = initFromRequest(input, headers);
      for (var k in init) { if (k !== 'headers' && Object.prototype.hasOwnProperty.call(init, k) && init[k] !== undefined) reqInit[k] = init[k]; }
      if (method !== 'GET' && method !== 'HEAD') {
        p = input.clone().text().then(function (text) {
          if (text) reqInit.body = isOrderPost ? withPushToken(text) : text;
          return _fetch(url, reqInit);
        });
      } else {
        p = _fetch(url, reqInit);
      }
    } else {
      var nextInit = Object.assign({}, init, { headers: headers });
      if (isOrderPost && typeof nextInit.body === 'string') nextInit.body = withPushToken(nextInit.body);
      p = _fetch(url, nextInit);
    }

    // Placing the order creates the Stripe PaymentIntent server-side — give the
    // money call real headroom. Aborting it early risks the customer retrying
    // an order that actually went through (the server keeps going after a
    // client-side timeout). Everything else keeps the till's snappy 12s.
    p = withTimeout(p, isOrderPost ? 25000 : 12000);

    // (3,4) captures — awaited so the page's next request carries the state.
    if (/\/api\/account\/(signin|signup|reset-password)(\?|$)/.test(url)) return p.then(captureAuth);
    if (/\/api\/account\/(signout|delete)(\?|$)/.test(url)) return p.then(function (res) { setToken(''); return res; });
    if (isOrderPost) return p.then(captureOrder);
    return p;
  }

  function installFetchShim() {
    if (!inApp || typeof window.fetch !== 'function') return;
    if (window.__luminFetch && window.fetch === window.__luminFetch) return;
    var _fetch = window.fetch.bind(window);
    var wrapper = function (input, init) {
      return ready.then(function () { return doFetch(_fetch, input, init); });
    };
    window.__luminFetch = wrapper;
    window.fetch = wrapper;
  }

  installFetchShim();
  if (inApp && document.readyState === 'loading') {
    // Re-assert in case CapacitorHttp patches window.fetch after us (P2-14).
    window.addEventListener('DOMContentLoaded', installFetchShim);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // Parser-loaded per-shop assets (<img src="/logo.png">, menu photos) bypass
  // the fetch shim — point them at the live site. Re-run as the menu renders.
  function rewriteParserAssets() {
    if (!BASE) return;
    var imgs = document.querySelectorAll('img[src^="/"]');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src');
      if (src && src.charAt(0) === '/' && src.charAt(1) !== '/') imgs[i].src = BASE + src;
    }
  }

  // ── External links open in the system browser, not inside the shell ────────
  var EXTERNAL_PATHS = /^\/(privacy|terms|allergy-info)(\/|$)/;
  function browserOpen(url) {
    var B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (B && B.open) { B.open({ url: url }); return true; }
    try { window.open(url, '_blank'); return true; } catch (e) { return false; }
  }
  function interceptLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        // Any absolute link (socials, maps, the website) leaves the shell.
        e.preventDefault();
        browserOpen(href);
      } else if (EXTERNAL_PATHS.test(href)) {
        // Legal pages aren't bundled — read them on the live site.
        e.preventDefault();
        browserOpen(BASE + href);
      }
      // tel: / mailto: fall through — the WebView hands them to the OS.
    }, true);
  }

  if (inApp) {
    ready.then(function () {
      // Tell Capgo this OTA bundle booted OK — without this the updater
      // auto-reverts to the previous bundle (the bad-update safety net).
      try {
        var cu = window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater;
        if (cu && cu.notifyAppReady) cu.notifyAppReady();
      } catch (e) {}
      onReady(function () {
        // Let the page extend under the notch/home indicator — the app-mode CSS
        // pads with env(safe-area-inset-*). Done here, not in the template, so
        // the website's viewport is untouched.
        try {
          var vp = document.querySelector('meta[name="viewport"]');
          if (vp && vp.content.indexOf('viewport-fit') === -1) vp.content += ',viewport-fit=cover';
        } catch (e) {}
        rewriteParserAssets();
        interceptLinks();
        // Menu photos render after the menu JSON arrives — sweep again as
        // content mounts (cheap: attribute reads + at most one write each).
        try {
          new MutationObserver(function () { rewriteParserAssets(); })
            .observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
      });
    });
  }
})();
