# LumiPOS — the Android app (Capacitor)

A thin native Android wrapper around the existing web staff EPOS. **One APK for
every shop AND both devices**, provisioned per device. Self-contained: nothing
here affects the web build or the live sites (the Cloudflare build only ever
looks at `public/`).

**Two devices run this same APK** — see `docs/PRODUCTS.md`:
- **Sunmi T2** — the full LumiPOS till (printer + cash drawer + counter sales).
- **ZCS Z93** — the small unit a **LumiWEB** shop gets: built-in 80mm printer,
  no drawer, used to receive and print online orders.

The printer backend is chosen **at runtime, per call**, so there is no
per-device build. Don't fork the APK.

> **Status: LIVE.** Running on a real Sunmi T2s and on a Z93, taking orders, and
> **fully on OTA** — a push to `main` touching `templates/staff/**` or
> `app/web/**` republishes the bundle to every till. The one outstanding APK item
> is **signing** (the Z93 is on a debug build — `docs/TODO.md`). Background and
> decisions: `docs/PHASE2_APP.md`; live state: `docs/SESSION_HANDOFF.md`.

## Prerequisites (on your Mac)
- Node 18+ and the repo root deps (you already have these).
- **Android Studio** (gives you the Android SDK, platform-tools, an emulator).
- A JDK 17+ (Android Studio bundles one).
- The device (T2 or Z93) in developer mode (USB debugging) to install/test on-device.

## First build
```bash
# 1) From the REPO ROOT — build the staff UI for the shop you're testing:
SHOP_SLUG=ricos npm run build

# 2) In this folder:
cd app
npm install
npm run prepare:android      # syncs www/ from the built staff page + `cap add android`

# 3) Register the native plugin (one-off):
#    follow app/native/android/README.md (copy EposHardwarePlugin.kt + MainActivity)

# 4) Open in Android Studio to run / sign / install:
npm run open:android
```
After code changes to the staff UI, re-run from the root `npm run build`, then in
`app/`: `npm run sync` (re-syncs www + `cap sync android`).

## Bundled mode works (token auth)
Login returns a bearer token to the app (the web stays on its HttpOnly cookie); the
app stores it and sends it as `Authorization`, and CapacitorHttp proxies requests
natively (no CORS). So bundled mode talks to the provisioned shop backend out of the box.

(Optional) **server.url** is still available as a quick browser-style run — the WebView
loads the live staff page directly, same-origin:

Add to `capacitor.config.json` temporarily:
```json
"server": { "androidScheme": "https", "url": "https://<your-dev-preview>.pages.dev/staff", "cleartext": false }
```
then `npm run sync && npm run open:android`. This is a stopgap for testing the
shell/hardware bridge; revert to bundled once token auth is in.

## Provisioning
On first launch (bundled mode) the app shows **“Set up this till”** — enter the
shop’s site address (e.g. `https://ricos.pages.dev`). It’s stored on the device and
every request is routed to that backend. Re-provision by clearing app storage.

## What works / what's stubbed
- ✅ App loads the real staff EPOS (bundled) + provisioning + request routing shim.
  The web-sync bundles the CSP-externalised `/staff/index.inlineN.js`, so the till
  actually has its JS (it didn't before — that was a blank-screen blocker).
- ✅ Token auth — bundled mode talks to the shop backend; the web is unchanged. The
  bearer token + base URL live in `@capacitor/preferences` (off localStorage), loaded
  in an async bootstrap that every shimmed request awaits.
- ✅ `printDoc` / `printReceipt` wired to **both** printer backends — the Sunmi
  inner-printer service (T2) and the bundled ZCS SmartPos SDK (Z93) — picked per
  call. `kickDrawer` is the ESC/POS `sendRAWData` pulse and is **Sunmi-only**; on a
  Z93 it returns `drawer-not-connected`, which is correct (no drawer port).
  Both SDKs are wired in automatically by `app/scripts/inject-native.mjs`.
  Printer changes can't be verified in the cloud build — smoke-test on-device.
- ⏳ `collectCardPayment` is still a stub — Stripe Terminal is scoped in
  `docs/PHASE3_TERMINAL.md` (reader decision pending).
- ⏳ Live-update channel + wiring the Sale flow to the bridge — see `docs/PHASE2_APP.md`.
