# Phase 4 — Customer ordering apps (iOS + Android, Capacitor wrapper)

> Status: **implemented in-repo** (backend + generator + shims + CI + docs).
> What remains is external: store/Firebase/Capgo account setup, on-device
> builds, and store submissions — all covered by `ADDING_A_SHOP_APP.md`.

The customer-facing sibling of Phase 2 (the LumiPOS till, `docs/PHASE2_APP.md`):
each shop's website order flow, wrapped in a branded native shell and sold as
an app product. One shared codebase in `app-customer/`; one binary per shop.

## Decisions (locked with the owner)

- **Wrap, don't rewrite** — the app bundles the BUILT `order.html` +
  `thank-you.html` (golden rule #3: the app *is* the ordering flow we already
  have). Per-shop behaviour is gated by config/`app-mode`, never forked.
- **One binary per shop, identity baked at build time** — the inverse of the
  till's runtime provisioning, because store listings are per-brand. The shop
  is chosen by `SHOP_SLUG` at generate time (`app-customer/scripts/gen-shop.mjs`
  reads the `app` block in `data/shops/<slug>/config.json`); the API base is
  baked as `https://<business.domain>` (exact apex — never a 301ing variant).
- **Store account model: single Lumin Labs org accounts** on both stores, one
  listing per shop (own bundle id / icon / branding / copy).
  *Accepted risk:* Apple 4.2.6 nominally wants template apps under the content
  owner's account. Mitigations: every listing genuinely differentiated (the
  per-shop config/menu/photos make this real, not cosmetic); never submit a
  bare WebView (push + live tracking + accounts ship in build one); and the
  fallback — moving an app to the restaurant's own Apple account, or an
  aggregator "picker" app — is store-ops only, zero code change, because
  bundle ids are already per-shop.
- **Card-first payments in-app** — Stripe Payment Element + saved cards + cash
  work in the WebView. Apple Pay / Google Pay are HIDDEN in app-mode (native
  wallet sheets don't work in a WebView shell); a native Stripe plugin is the
  v2 path. Food is physical goods → no IAP requirement (3.1.3(e)).
- **Push via FCM for both platforms** (APNs routed through FCM). ONE Firebase
  project for the whole platform; each shop's app is a registration inside it.
  Transactional order-status pushes only — marketing push needs its own PECR
  opt-in and is deliberately out of scope.
- **Bundle + Capgo OTA per shop** (same rationale as the till: `server.url`
  can't work per-shop, and bundling keeps first paint instant). Channel
  `production`, versions `1.1.<run>` over manual `1.0.x` binaries.

## How it fits together

```
data/shops/<slug>/config.json ("app" block) + app/icon.png [+ Firebase files]
        │
        │  (root) SHOP_SLUG=<slug> npm run build      → public/order.html, thank-you.html, *.inline*.js
        │  (app-customer) SHOP_SLUG=<slug> npm run gen → capacitor.config.json, gen/app-base.js, assets/
        │  (app-customer) npm run sync-web             → www/  (pages + shims + bundle-only path rewrites)
        ▼
   app-customer/www  ──ota──▶  Capgo (per-shop app, channel production)  ──▶ installed apps
        │
        └─ cap add android/ios → patch-android/patch-ios → Android Studio / Xcode → store binaries
```

- **`web/native.js`** (adapted from the till's): rewrites the page's relative
  `/api/…` to the baked origin via CapacitorHttp (no CORS), tags `X-Client:
  app`, attaches the customer Bearer token, captures it from
  signin/signup/reset responses (Preferences `cust_token`), records
  `{orderId, statusToken}` from each POST /api/order into localStorage
  `<slug>.lastOrder`, injects the cached push token into order bodies, opens
  external/legal links in the system browser, rewrites parser-loaded images to
  the live site. **Shop-bound requests only** — Stripe.js calls to
  api.stripe.com pass through untouched (injecting our Authorization header
  there would clobber Stripe's and leak the session token).
- **`web/push.js`** — `LuminNative.enableOrderPush(orderId, statusToken)`:
  permission → FCM registration → `POST /api/order/:id/push` for the
  just-placed order → cache for all future orders. Notification taps reopen
  the tracking screen.
- **Bundle-only rewrites** (`scripts/sync-web.mjs`): `/thank-you?ref=` →
  `/thank-you.html?ref=` (Stripe's `return_url` and the success navigation
  must hit the bundled FILE — an extensionless path would SPA-fall-back to the
  order page), thank-you back-buttons → `/index.html`, and `logo.png` is
  bundled (it's referenced relatively, invisible to both rewriting layers).

## Backend (all shared, all web-safe)

- **Customer Bearer auth** — `resolveCustomerSession()` in
  `functions/_lib/customer-auth.js` accepts the `cu` cookie (web) OR
  `Authorization: Bearer` (app); signin/signup/reset return the token in the
  body only under `X-Client: app`. Mirrors the staff pattern exactly.
- **Token-type separation (security fix shipped with this phase)** — every
  token kind signed with `SESSION_SECRET` now verifies ONLY as its own kind:
  staff `verifySessionToken` rejects customer-claim (`c`) payloads (before
  this, an emailed password-reset token replayed as a Bearer PASSED staff
  auth), reset tokens carry `r:1` and sessions reject it (and vice versa),
  order-status tokens carry `scope:'order-status'`. Covered by
  `test/customer-auth.test.mjs` cross-type assertions.
- **Live tracking** — `POST /api/order` returns a `statusToken` (48h HMAC
  capability, `functions/_lib/order-token.js`); `GET /api/order/:id/status`
  returns lifecycle state only (no PII). The thank-you screen polls it and
  renders the timeline (app-mode only).
- **Push** — `functions/_lib/push.js` (FCM v1, service-account JWT via
  WebCrypto, OAuth token cached in KV); order-scoped device tokens (guest
  friendly, PECR-safe transactional) attached at order time (shim) or after
  (thank-you screen); sends fired best-effort from staff accept/status
  transitions. Secret: `FCM_SERVICE_ACCOUNT_JSON` on every shop project.
- **Rate limiting** — `functions/_lib/rate-limit.js` (extracted from the staff
  login limiter) now guards signin/signup/forgot-password, `POST /api/order`,
  order status/push.
- **Account deletion** — `POST /api/account/delete` + a button in the account
  modal (Apple 5.1.1(v) hard requirement; shipped web-wide on purpose).

## App-mode contract (the ONLY web/app divergence surface)

The shim sets `window.LUMIN_APP` and `html.app-mode` before page scripts run.
Templates gate on those and nothing else: hide the back-link, safe-area
padding, skip Express Checkout, show the tracking timeline + push opt-in.
On the website neither marker exists, so behaviour is byte-identical.

## CI

`.github/workflows/customer-ota.yml` — discover app-enabled shops → verify
(unit tests incl. `test/customer-auth.test.mjs` + shim tests + per-shop build
+ `node --check` the emitted pages) → publish matrix per shop, gated on the
**`ota-customer-production`** environment (separate approval from the till's
`ota-production`; one `main` push must never silently deploy both fleets under
one gate). `data/shops/**` triggers republish because per-shop tokens (theme,
phone, promo copy) are baked into the bundled pages.

## What's done vs TODO

- [x] backend: Bearer auth, token-type separation, status endpoint + tokens,
      push lib + hooks, rate limits, account deletion
- [x] `app-customer/` generator + sync + shims + Android/iOS patch scripts
- [x] order/thank-you app-mode gating, tracking timeline, push opt-in UI
- [x] tests: `test/customer-auth.test.mjs` (28), `app-customer` shim harness (24)
- [x] `customer-ota.yml` + runbook (`ADDING_A_SHOP_APP.md`)
- [ ] platform accounts: Apple org, Play org, Firebase project + secrets, Capgo apps
- [ ] first on-device build (Rico's, Android) + Play internal track
- [ ] iOS build (Mac/Xcode; add `@capacitor-community/fcm`), TestFlight
- [ ] store listings + submissions (differentiation checklist per shop)
- [ ] v2: native Apple Pay/Google Pay plugin, universal links, account-level
      marketing push with PECR opt-in, `store-build.yml` CI signing
