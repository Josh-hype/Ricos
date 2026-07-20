# Adding a shop's customer APP (iOS + Android)

The app is the paid add-on to a shop's website: their existing order +
thank-you pages wrapped in a branded native shell (`app-customer/`), published
to the App Store and Play Store, updated over-the-air via Capgo. One shared
codebase; the shop's identity (bundle id, name, icon, API base) is baked at
build time from the `app` block in `data/shops/<slug>/config.json`.

Prerequisite: the shop is already live on the web (see `ADDING_A_SHOP.md`) —
the app talks to that same Cloudflare backend and inherits its menu, prices,
hours, Stripe account and email flows.

Architecture + decisions: `PHASE4_CUSTOMER_APP.md`.

---

## 0. One-time platform setup (not per shop)

Skip anything already done:

- **Apple Developer Organization account** for Lumin Labs ($99/yr; needs a
  DUNS number — enrolment can take days to weeks, start early).
- **Google Play Console organisation account** for Lumin Labs ($25 one-off;
  org accounts skip the 12-testers/14-days rule that hits personal accounts).
- **One Firebase project** (e.g. `lumin-orders`) for push across ALL shops.
  Generate a service-account key (Project settings ▸ Service accounts) and set
  it as the Cloudflare secret `FCM_SERVICE_ACCOUNT_JSON` on **every shop's**
  Pages project (same value everywhere).
- **Capgo org** — the existing `CAPGO_TOKEN` repo secret covers customer apps.
- **GitHub Environment `ota-customer-production`** (repo Settings ▸
  Environments) with required reviewers — the approval gate for pushing
  web-layer updates to customers' phones. Keep it separate from the till's
  `ota-production`.

## 1. Collect from the restaurant

- **App display name** (under the icon, ≤ 30 chars for the stores) — usually
  the trading name.
- **Store icon** — 1024×1024 PNG, no transparency, no rounded corners
  (the stores round it). A square version of their logo works.
- Optional **splash image** (2732×2732 PNG, centred logo on brand colour).
- **Store listing copy**: one-line subtitle, a paragraph description, 3–5
  keywords. Write it WITH them — each listing must read distinct (see the
  differentiation checklist below).
- Consent to a **demo account** for Apple/Google review (a real customer
  account with a known password; reviewers test-order with cash-on-collection
  and the shop voids it).

## 2. Configure the shop folder

1. `data/shops/<slug>/config.json` — add/enable the `app` block (template in
   `data/shops/_template/config.json`):
   ```json
   "app": {
     "enabled": true,
     "appId": "uk.co.<domain-ish>.orders",
     "appName": "<Display Name>",
     "deepLinkScheme": "<slug>-orders",
     "ios": { "ascAppId": "" },
     "android": { "playTrack": "internal" }
   }
   ```
   `appId` is permanent once published — derive it from their domain and never
   change it. The build fails loudly on a malformed block.
2. `data/shops/<slug>/app/` — drop in `icon.png` (1024×1024) and optional
   `splash.png`.
3. **Firebase** (push): in the `lumin-orders` project add an **Android app**
   with the shop's `appId` and an **iOS app** with the same bundle id.
   Download `google-services.json` + `GoogleService-Info.plist` into
   `data/shops/<slug>/app/` (registration files, not secrets — committable).
   For iOS, upload the Apple **APNs auth key** (.p8) to that Firebase iOS app
   (Project settings ▸ Cloud Messaging).
4. **Capgo**: `cd app-customer && SHOP_SLUG=<slug> npm run gen && npm run ota:setup`
   (registers a Capgo app under the shop's appId; then create channel
   `production` with "disable auto update: major").

## 3. Build & test

```bash
# repo root — build the shop's site (the app bundles these pages)
SHOP_SLUG=<slug> npm run build

# app-customer/
npm install
SHOP_SLUG=<slug> npm run prepare:android    # Android Studio project
SHOP_SLUG=<slug> npm run prepare:ios        # Xcode project (Mac only)
```

One-time in Xcode per app: signing team, **Push Notifications** capability,
**Background Modes → Remote notifications**; add
`@capacitor-community/fcm` for iOS push tokens (see `app-customer/README.md`).

**On-device smoke list** (emulator + at least one real phone):
- menu loads (live API); photos load; theme/colours correct
- create account + sign in — survives an app restart (Bearer token)
- cash order → appears on the shop's till; thank-you screen shows the tracking
  timeline; accept on the till → push notification arrives + timeline advances
- card order (small, live — void it after): Payment Element renders, payment
  confirms, in-shell thank-you, order promotes to the kitchen
- delete account works; external links (socials/legal) open the system browser

## 4. Store submissions (internal track first)

- **Play**: create the app in the Lumin Play Console, upload keystore-signed
  AAB (keep the upload keystore per app; enable Play App Signing), internal
  testing track → promote to production when smoke-tested. Data Safety form:
  collects name, email, phone, address, purchase history — app functionality
  only, no ads/tracking.
- **App Store**: create the app in App Store Connect (record its Apple id in
  `config.app.ios.ascAppId`), TestFlight internal group first. Privacy
  labels: same data set as Play. Review notes: demo account credentials,
  "order with cash on collection to test checkout — the restaurant voids it",
  and that this is physical-goods food ordering (guideline 3.1.3(e) — no IAP).
- **Differentiation checklist** (Apple 4.2.6/4.3 protection — run before EVERY
  submission): distinct icon + palette + fonts (from the shop's theme), the
  shop's real menu and photos, shop-specific description/screenshots/promo
  copy. Never submit two near-identical listings in the same review window.

## 5. Register + go live

- Note the app in `data/platform/registry.json` under the shop's entry, e.g.
  `"app": { "android": "production", "ios": "in-review" }` — the owner console
  reads this file as the source of truth.
- Merge to `main`. From now on, order/thank-you template changes (and that
  shop's config changes) auto-publish an OTA bundle via
  `.github/workflows/customer-ota.yml` after the `ota-customer-production`
  approval. Store binaries only need rebuilding when the native shell changes
  (new plugins, new Capacitor major, icon change).

## Gotchas

- **`appId` is forever** — a published bundle id can't be renamed, only
  replaced by a new listing. Triple-check before first upload.
- **Bake the exact apex domain** — `business.domain` becomes the app's API
  base; `public/_redirects` 301s `www`/`.com` variants and a 301 breaks POSTs
  (same rule as the till's provisioning directory).
- **A `main` push is a fleet deploy** — `scripts/build-shop.js` triggers BOTH
  the till and customer OTA workflows. Keep required reviewers on both
  environments.
- **Push without Firebase files** — the app builds and runs; registration just
  fails quietly. The gen step warns; don't ship a store build that way.
