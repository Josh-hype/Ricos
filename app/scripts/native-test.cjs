/* Headless harness for app/web/native.js — mocks the Capacitor/WebView globals and
   exercises the device-independent logic (URL rewrite, header injection, token
   capture/persist, Request-as-init fix, sign-out, re-assert). Not committed. */
const fs = require('fs');
const assert = require('assert');
const NATIVE_JS = require('path').resolve(__dirname, '..', 'web', 'native.js');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ✓ ' + msg); passed++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Mocked native environment ────────────────────────────────────────────────
const prefStore = {};
const Preferences = {
  get: async ({ key }) => ({ value: key in prefStore ? prefStore[key] : null }),
  set: async ({ key, value }) => { prefStore[key] = String(value); },
  remove: async ({ key }) => { delete prefStore[key]; },
};
const lsStore = {};
global.localStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: (k) => { delete lsStore[k]; },
};
const domHandlers = {};
global.document = {
  readyState: 'loading', // as in a real WebView at <head>-script time → re-assert registers
  addEventListener: (ev, fn) => { (domHandlers[ev] = domHandlers[ev] || []).push(fn); },
  querySelectorAll: () => [],
};

let lastCall = null;
function baseFetch(url, init) {
  lastCall = { url, init, initIsRequest: (typeof Request !== 'undefined') && (init instanceof Request) };
  const body = (url.indexOf('/api/staff/login') !== -1)
    ? JSON.stringify({ ok: true, token: 'TOKEN-FROM-LOGIN' })
    : JSON.stringify({ ok: true });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
}
global.window = {
  Capacitor: { isNativePlatform: () => true, Plugins: { Preferences } },
  fetch: baseFetch,
  addEventListener: (ev, fn) => { (domHandlers[ev] = domHandlers[ev] || []).push(fn); },
};
Object.defineProperty(global, 'fetch', { get: () => global.window.fetch, set: (v) => { global.window.fetch = v; }, configurable: true });

(async () => {
  // Seed Preferences as if already provisioned.
  prefStore['epos_api_base'] = 'https://ricos.pages.dev';

  // Load native.js into this scope (it's an IIFE referencing bare window/document/localStorage).
  const code = fs.readFileSync(NATIVE_JS, 'utf8');
  eval(code);

  await sleep(10); // let the async bootstrap resolve

  console.log('\n1) Bootstrap reads BASE from Preferences (async)');
  ok(global.window.EPOS_API_BASE === 'https://ricos.pages.dev', 'EPOS_API_BASE populated from Preferences');
  ok(global.window.EPOS_IS_APP === true, 'EPOS_IS_APP true on native platform');
  ok(global.window.fetch !== baseFetch, 'window.fetch was wrapped by the shim');

  console.log('\n2) Relative GET is rewritten to BASE + carries X-Client (no token yet)');
  await global.window.fetch('/api/staff/orders', { cache: 'no-store' });
  ok(lastCall.url === 'https://ricos.pages.dev/api/staff/orders', 'URL rewritten to provisioned backend');
  ok(lastCall.init.headers.get('X-Client') === 'app', 'X-Client: app injected');
  ok(!lastCall.init.headers.get('Authorization'), 'no Authorization before login');
  ok(lastCall.init.cache === 'no-store', 'original init (cache) preserved');

  console.log('\n3) Login response token is captured + persisted to Preferences');
  const res = await global.window.fetch('/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pin":"1234"}' });
  const body = await res.json(); // page must still be able to read the body (clone was used)
  ok(body.token === 'TOKEN-FROM-LOGIN', 'login response body still readable by the page');
  await sleep(5);
  ok(prefStore['epos_token'] === 'TOKEN-FROM-LOGIN', 'token persisted to Preferences (not localStorage)');
  ok(!('epos_token' in lsStore), 'token NOT written to localStorage');

  console.log('\n4) Next request carries the captured bearer token');
  await global.window.fetch('/api/staff/me');
  ok(lastCall.init.headers.get('Authorization') === 'Bearer TOKEN-FROM-LOGIN', 'Authorization: Bearer <token> injected');

  console.log('\n5) Request-object input → explicit RequestInit (P2-13), body/headers preserved');
  // A relative-URL Request (what a WebView allows; Node's Request can't take one) — also
  // exercises native.js's clone().arrayBuffer() body extraction.
  const reqObj = {
    url: '/api/staff/counter-order', method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json', 'X-Custom': 'keep' }),
    mode: 'cors', credentials: 'include', cache: 'default', redirect: 'follow',
    referrer: '', referrerPolicy: '', integrity: '', keepalive: false, signal: undefined,
    clone() { return { arrayBuffer: async () => new TextEncoder().encode('{"x":1}').buffer }; },
  };
  await global.window.fetch(reqObj);
  ok(lastCall.url === 'https://ricos.pages.dev/api/staff/counter-order', 'Request URL rewritten to BASE');
  ok(lastCall.initIsRequest === false, 'init is a plain RequestInit, NOT a Request object');
  ok(lastCall.init.method === 'POST', 'method preserved from Request');
  ok(lastCall.init.headers.get('X-Custom') === 'keep', "Request's own header preserved");
  ok(lastCall.init.headers.get('X-Client') === 'app' && lastCall.init.headers.get('Authorization') === 'Bearer TOKEN-FROM-LOGIN', 'app headers injected onto Request path');
  ok(lastCall.init.body && lastCall.init.body.byteLength > 0, 'request body carried through (ArrayBuffer)');

  console.log('\n6) onSignOut clears token (memory + Preferences), keeps provisioning');
  global.window.EPOSNative.onSignOut();
  await sleep(5);
  ok(!('epos_token' in prefStore), 'token removed from Preferences on sign-out');
  ok(prefStore['epos_api_base'] === 'https://ricos.pages.dev', 'base URL (provisioning) retained');
  await global.window.fetch('/api/staff/orders');
  ok(!lastCall.init.headers.get('Authorization'), 'no Authorization after sign-out');

  console.log('\n7) installFetchShim re-asserts if CapacitorHttp patches fetch AFTER us (P2-14)');
  const ourShim = global.window.fetch;
  // Simulate CapacitorHttp replacing window.fetch late, then fire DOMContentLoaded.
  let lateCall = null;
  global.window.fetch = function (u, i) { lateCall = { u, i }; return baseFetch(u, i); };
  (domHandlers['DOMContentLoaded'] || []).forEach((fn) => fn());
  ok(global.window.fetch !== ourShim, 'a new outer wrapper was installed over the late fetch');
  await global.window.fetch('/api/config');
  ok(lateCall && lateCall.i && lateCall.i.headers.get('X-Client') === 'app', 'headers still injected into the late CapacitorHttp fetch');

  console.log(`\nALL PASS — ${passed} assertions.`);
})().catch((e) => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
