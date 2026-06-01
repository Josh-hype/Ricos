# Phase 2 — Sunmi T2 app (Capacitor wrapper)

> Status: **scaffold** (structure + native bridge + provisioning + docs). It does
> not produce a finished, signed APK yet — that needs the Android SDK + a physical
> T2, which aren't available in the cloud build environment. Everything here is
> written so it slots together on a Mac with Android Studio. Nothing in this folder
> affects the live web EPOS or the Cloudflare build.

## Decisions (locked with the owner)
- **Wrap, don't rewrite** — a thin native Android shell (Capacitor) around the
  existing web staff EPOS, plus native plug-ins for the hardware. One codebase
  (golden rule #3): the app *is* the EPOS we already have.
- **One APK + per-device provisioning** — a single app for all 20–30+ shops; each
  device is set once to a shop (stores that shop's backend base URL). The app-layer
  equivalent of `SHOP_SLUG`. No per-shop builds.
- **Bundle UI + live-update** — ship the staff UI inside the APK (offline + off the
  public web); push UI updates without a full reinstall (see "Updates" below).
- **Native bridge** for Tap-to-Pay (Stripe Terminal) + the Sunmi printer/drawer;
  the same web code falls back to cash + browser behaviour when run in a browser.
- **Card = recorded manually for now** — Tap-to-Pay capture is scaffolded but not
  wired until the reader path is confirmed (Phase 3).

## How it fits together
```
templates/staff/index.html ──(root: npm run build)──▶ public/staff/index.html
                                                            │
                                   app/scripts/sync-web.mjs │ copies + injects shim
                                                            ▼
                              app/www/index.html  +  native.js / provision.js / plugins
                                                            │  (npx cap add/sync android)
                                                            ▼
                                          android/  (generated APK project)
                                                            │  + EposHardware native plugin
                                                            ▼
                                              Sunmi T2 (installable APK)
```

- **`app/web/native.js`** — loaded *before* the staff script in the app build. It:
  - reads the provisioned shop base URL and exposes `window.EPOS_API_BASE`;
  - transparently rewrites the staff page's relative `\`/api/…\`` + asset requests to
    that backend (so we don't have to edit the 3,000-line staff template);
  - exposes `window.EPOSNative` (printReceipt / kickDrawer / collectCardPayment),
    which call the native plugin in the app and are safe no-ops on the web.
- **`app/web/provision.js`** — first-run "set up this till" screen (enter the shop
  site address; stored in Capacitor Preferences, awaited before reload).
- **`app/web/plugins/epos-hardware.js`** — JS interface to the native Capacitor plugin.
- **`app/native/android/EposHardwarePlugin.kt`** — the native plugin (printer/drawer/
  Tap-to-Pay), with TODOs for the Sunmi + Stripe Terminal SDKs.

## Auth across origins — resolved (bearer token)
In **bundled** mode the WebView origin is `https://localhost`, but the backend is the
shop's domain — so requests are **cross-origin**. The staff session is an HttpOnly,
SameSite=Lax cookie, which a browser won't send on cross-site requests. The options were:
- **(recommended) token auth** — issue a bearer token at login, store it in the app
  (Preferences), send it as `Authorization`; backend accepts it alongside the cookie.
  A focused, contained change to `_lib/auth.js` + `login.js` + the gated endpoints.
- cookie `SameSite=None; Secure` + WebView third-party cookies + CORS-with-credentials
  (fragile), or
- **`server.url` quick-run** — point the WebView at the live (protected) staff URL.
  Same-origin, cookies just work, **zero backend change** — but online-only and the UI
  still loads from a URL. Great for an immediate on-device smoke test.

**Resolved → bearer token (implemented).** Login now also returns the signed session
token — but only when the request carries `X-Client: app`, so the web response is
unchanged and the token never appears in a browser body. The app stores it and sends
`Authorization: Bearer <token>`. `resolveSession()` in `_lib/auth.js` accepts the
cookie (web) OR the Bearer token (app) — the same signed token either way. CapacitorHttp
is enabled so requests are proxied natively (no browser CORS). The web keeps using the
HttpOnly cookie exactly as before. `server.url` remains available as a quick browser-style
run (see `app/README.md`).

## Updates (no reinstall for UI tweaks)
The APK shell rarely changes. UI updates flow via a live-update channel:
- **Appflow** (Ionic, paid), or
- a **DIY signed bundle**: host the synced `www/` as a zip on Cloudflare/R2, the app
  checks a version endpoint on launch and swaps the web layer. (To build in Phase 3.)

## Build / run (summary — full steps in `app/README.md`)
```bash
# 1. at repo root, build the staff UI
SHOP_SLUG=ricos npm run build
# 2. in app/
cd app && npm install
npm run prepare:android        # sync www + npx cap add android
# 3. register the native plugin (see app/native/android/README.md)
npx cap open android           # build / run / sign in Android Studio, install to the T2
```

## What's done vs TODO
- [x] Capacitor project scaffold, config, web-sync pipeline
- [x] `native.js` fetch shim + hardware facade + provisioning screen
- [x] native plugin source (printer / drawer / Tap-to-Pay) with TODOs
- [x] runbook + this architecture doc
- [x] cross-origin auth — bearer token + CapacitorHttp (web stays cookie-based)
- [x] **web-sync bundles the CSP-externalised inline scripts** (`/staff/index.inlineN.js`)
      into `app/www/staff/` — without this the bundled app loaded the staff HTML with no JS
- [x] **app hardening:** token + base URL → `@capacitor/preferences` (async bootstrap, off
      localStorage); fetch shim builds an explicit `RequestInit`; provisioning awaits the
      write before reload; the shim re-asserts over CapacitorHttp so headers always inject
      (verified headless — `app/scripts/native-test.cjs` / `npm test`; still smoke-test on-device)
- [x] **printer + drawer wired** to the Sunmi inner-printer service (drawer via ESC/POS
      `sendRAWData` kick) — needs the `com.sunmi:printerlibrary` Gradle dep + on-device test
- [x] **Stripe Terminal scoped** → `docs/PHASE3_TERMINAL.md` (reader decision pending)
- [ ] Stripe Terminal capture: `/api/staff/terminal/connection-token` + `card_present` PI +
      capture-on-confirm (closes P2-10) + native reader flow — *blocked on the reader decision*
- [ ] live-update channel
- [ ] wire the Sale flow to call `EPOSNative.printReceipt` / `collectCardPayment`
- [ ] signed release APK + Sunmi fleet distribution
