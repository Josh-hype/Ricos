# EPOS Till — Sunmi T2 app (Capacitor)

A thin native Android wrapper around the existing web staff EPOS. **One APK for
all shops**, provisioned per device. Self-contained: nothing here affects the web
build or the live sites (the Cloudflare build only ever looks at `public/`).

> **Status: scaffold.** Builds toward a real APK but isn't a finished/signed one —
> that needs the Android SDK + a physical T2. See `docs/PHASE2_APP.md` for the full
> picture, decisions, and the open cross-origin-auth question.

## Prerequisites (on your Mac)
- Node 18+ and the repo root deps (you already have these).
- **Android Studio** (gives you the Android SDK, platform-tools, an emulator).
- A JDK 17+ (Android Studio bundles one).
- The Sunmi T2 in developer mode (USB debugging) to install/test on-device.

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
- ✅ Native plugin present: `printReceipt` / `kickDrawer` / `collectCardPayment` —
  currently resolve `{ ok:false, reason:'…-not-wired' }`.
- ✅ Token auth — bundled mode talks to the shop backend; the web is unchanged.
- ⏳ Sunmi printer/drawer SDK, Stripe Terminal Tap-to-Pay, live-update, and wiring
  the Sale flow to the bridge — see the TODO list in `docs/PHASE2_APP.md`.
