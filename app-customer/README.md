# Customer ordering app (Capacitor, iOS + Android)

The **branded customer app** each shop can sell alongside its website: the
built order + thank-you pages wrapped in a thin native shell, talking to the
shop's existing Cloudflare backend. One shared codebase; **one binary per
shop**, generated from the `app` block in `data/shops/<slug>/config.json` —
the app-layer mirror of `SHOP_SLUG`. Sibling of `app/` (the LumiPOS staff
till), which it deliberately copies patterns from; nothing here affects the
web build or the till.

Key differences from the till app:

| | Till (`app/`) | Customer (this) |
|---|---|---|
| Shop identity | one APK, provisioned at runtime | **baked at build time** (store listings are per-brand) |
| API base | Preferences (`epos_api_base`) | baked from `business.domain` |
| Auth | staff Bearer | customer Bearer (`cust_token`) |
| Hardware | Sunmi printer plugin | none |
| Push | none | FCM (order status) |

## Build one shop's app

```bash
# 1. at the repo root, build that shop's site
SHOP_SLUG=ricos npm run build

# 2. in app-customer/
npm install
SHOP_SLUG=ricos npm run prepare:android   # or prepare:ios (Mac + Xcode)
npx cap open android                       # build / sign / run in Android Studio
```

`gen` writes the per-shop identity (capacitor.config.json, gen/app-base.js,
icons, Firebase files); `sync-web` assembles `www/` from the built pages and
injects the shims (`app-base.js` → `native.js` → `push.js`). Both refuse to
run against a mismatched or missing root build. Everything generated is
gitignored — never commit `www/`, `android/`, `ios/`, `gen/`, `assets/`, or
`capacitor.config.json`.

Per-shop app inputs live in `data/shops/<slug>/`:
- `config.json` → `app` block (`enabled`, `appId`, `appName`, `deepLinkScheme`, …)
- `app/icon.png` (1024×1024 store icon; falls back to `icon.png`, then `logo.png`)
- `app/splash.png` *(optional)*
- `app/google-services.json` + `app/GoogleService-Info.plist` (Firebase — push;
  the app builds without them, push registration just fails gracefully)

## How the wrapper works

- **`web/native.js`** — the fetch shim (adapted from the till's). Rewrites the
  page's relative `/api/…` calls to the baked shop origin (CapacitorHttp
  proxies natively, so no browser CORS), tags them `X-Client: app`, attaches
  the customer Bearer token, captures it from signin/signup responses into
  Capacitor Preferences, records `{orderId, statusToken}` from each placed
  order for the tracking screen, injects the cached push token into order
  bodies, opens external/legal links in the system browser, and rewrites
  parser-loaded `<img src="/…">` to the live site. **Shop-bound requests
  only** — Stripe.js traffic to api.stripe.com passes through untouched.
- **`web/push.js`** — `LuminNative.enableOrderPush(orderId, statusToken)`,
  called by the thank-you screen after the first order: asks permission,
  registers with FCM, attaches the token to that order
  (`POST /api/order/:id/push`), caches it for all future orders. Notification
  taps reopen the tracking screen.
- **Bundle-only path rewrites** (`scripts/sync-web.mjs`): `/thank-you?ref=` →
  `/thank-you.html?ref=` (so Stripe's return_url and the success navigation
  resolve to the bundled file instead of SPA-falling-back to the order page),
  and the thank-you page's back-to-order buttons → `/index.html`. The
  deployed website is untouched.
- Menu, config, prices, photos all come from the shop's **live API** at
  runtime — menu edits never require an app update.

## OTA updates (Capgo)

Each shop's app is its own Capgo app (keyed on its appId), channel
`production`, uploaded by `.github/workflows/customer-ota.yml` on pushes to
`main` that touch the order/thank-you templates or this folder — gated behind
the `ota-customer-production` GitHub Environment, separately from the till's
gate. Store binaries (AAB/IPA) are only needed when the native shell changes;
web-layer changes ship OTA (store-compliant for JS/asset updates).

## iOS notes

- `cap add ios` needs a Mac with Xcode; one-time per app in Xcode: signing
  team, Push Notifications capability, Background Modes → Remote
  notifications, and upload the APNs key to the Firebase iOS app.
- iOS push tokens: install `@capacitor-community/fcm` in iOS builds —
  `push.js` prefers `FCM.getToken()` there (the bare registration event gives
  an APNs token, which the FCM-v1 backend can't address).

## Tests

`npm test` runs `scripts/native-test.cjs` — a headless harness for the shim
(URL rewriting, third-party pass-through, token capture/clear, order capture,
push injection). Run it after any `web/native.js` change.

Full store/onboarding runbook: `docs/ADDING_A_SHOP_APP.md`.
Architecture + decisions: `docs/PHASE4_CUSTOMER_APP.md`.
