/* Headless harness for app-customer/web/native.js — mocks the Capacitor/WebView
   globals and exercises the device-independent logic: URL rewrite, shop-bound
   header scoping, token capture/persist/clear, order capture, push-token
   injection. Run from app-customer/ via `npm test`. */
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const NATIVE_JS = path.resolve(__dirname, '..', 'web', 'native.js');

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
const htmlClasses = new Set();
global.document = {
  readyState: 'loading',
  documentElement: { classList: { add: (c) => htmlClasses.add(c), contains: (c) => htmlClasses.has(c) } },
  addEventListener: (ev, fn) => { (domHandlers[ev] = domHandlers[ev] || []).push(fn); },
  querySelectorAll: () => [],
};

let lastCall = null;
function baseFetch(url, init) {
  lastCall = { url, init };
  let body = JSON.stringify({ ok: true });
  const u = String(url);
  if (u.includes('/api/account/signin')) body = JSON.stringify({ user: { name: 'T' }, token: 'CUST-TOKEN-1' });
  if (u.endsWith('/api/order')) body = JSON.stringify({ orderId: 'AB12CD3', orderNumber: 41, statusToken: 'ST-TOKEN', clientSecret: 'cs_x' });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
}
global.window = {
  LUMIN_APP_CONFIG: { base: 'https://ricosyork.co.uk', slug: 'ricos', scheme: 'ricos-orders', shortName: "Rico's" },
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Preferences } },
  fetch: baseFetch,
  addEventListener: (ev, fn) => { (domHandlers[ev] = domHandlers[ev] || []).push(fn); },
};
Object.defineProperty(global, 'fetch', { get: () => global.window.fetch, set: (v) => { global.window.fetch = v; }, configurable: true });

(async () => {
  const code = fs.readFileSync(NATIVE_JS, 'utf8');
  eval(code);
  await sleep(10); // let the async bootstrap resolve

  console.log('\n1) App marker set synchronously from the baked config');
  ok(global.window.LUMIN_APP && global.window.LUMIN_APP.base === 'https://ricosyork.co.uk', 'LUMIN_APP.base from app-base config');
  ok(global.window.LUMIN_APP.slug === 'ricos', 'LUMIN_APP.slug set');
  ok(htmlClasses.has('app-mode'), '<html> gets the app-mode class');
  ok(global.window.fetch !== baseFetch, 'window.fetch was wrapped by the shim');

  console.log('\n2) Relative shop request: rewritten + tagged, no token yet');
  await global.window.fetch('/api/config', { cache: 'no-store' });
  ok(lastCall.url === 'https://ricosyork.co.uk/api/config', 'URL rewritten to the baked shop origin');
  ok(lastCall.init.headers.get('X-Client') === 'app', 'X-Client: app injected');
  ok(!lastCall.init.headers.get('Authorization'), 'no Authorization before sign-in');
  ok(lastCall.init.cache === 'no-store', 'original init (cache) preserved');

  console.log('\n3) Third-party request passes through completely untouched');
  const stripeInit = { method: 'POST', headers: { Authorization: 'Bearer pk_live_stripe' } };
  await global.window.fetch('https://api.stripe.com/v1/payment_intents/pi_1/confirm', stripeInit);
  ok(lastCall.url === 'https://api.stripe.com/v1/payment_intents/pi_1/confirm', 'third-party URL not rewritten');
  ok(lastCall.init === stripeInit, 'third-party init object passed through as-is');
  ok(lastCall.init.headers.Authorization === 'Bearer pk_live_stripe', "Stripe's own Authorization untouched");

  console.log('\n4) Sign-in captures + persists the customer token');
  const res = await global.window.fetch('/api/account/signin', { method: 'POST', body: '{"contact":"a@b.c","password":"x"}' });
  const body = await res.json();
  ok(body.token === 'CUST-TOKEN-1', 'sign-in response body still readable by the page');
  await sleep(5);
  ok(prefStore['cust_token'] === 'CUST-TOKEN-1', 'token persisted to Preferences (not localStorage)');
  ok(!('cust_token' in lsStore), 'token NOT written to localStorage');

  console.log('\n5) Next shop request carries the Bearer token');
  await global.window.fetch('/api/account/me');
  ok(lastCall.init.headers.get('Authorization') === 'Bearer CUST-TOKEN-1', 'Authorization: Bearer <token> injected');

  console.log('\n6) POST /api/order: statusToken captured for the thank-you screen');
  await global.window.fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) });
  await sleep(5);
  const lastOrder = JSON.parse(lsStore['ricos.lastOrder'] || 'null');
  ok(lastOrder && lastOrder.orderId === 'AB12CD3', 'lastOrder.orderId stored in localStorage');
  ok(lastOrder.statusToken === 'ST-TOKEN', 'lastOrder.statusToken stored');
  ok(!('clientSecret' in lastOrder), 'clientSecret NOT stored');

  console.log('\n7) Cached push token is injected into order bodies');
  global.window.__luminSetPushToken('FCM-DEVICE-TOKEN', 'android');
  await global.window.fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'x' }] }) });
  const sent = JSON.parse(lastCall.init.body);
  ok(sent.push && sent.push.token === 'FCM-DEVICE-TOKEN', 'push.token injected into the order body');
  ok(sent.push.platform === 'android', 'push.platform injected');
  ok(sent.items.length === 1, 'original body fields preserved');
  await sleep(5);
  ok(prefStore['push_token'] === 'FCM-DEVICE-TOKEN', 'push token persisted to Preferences');

  console.log('\n8) Sign-out clears the stored token');
  await global.window.fetch('/api/account/signout', { method: 'POST' });
  await sleep(5);
  ok(!('cust_token' in prefStore), 'token removed from Preferences on signout');
  await global.window.fetch('/api/account/me');
  ok(!lastCall.init.headers.get('Authorization'), 'no Authorization after signout');

  console.log(`\nAll ${passed} assertions passed.`);
})().catch((e) => { console.error('\n✗ TEST FAILED:', e.message); process.exit(1); });
