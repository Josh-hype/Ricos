# Session handoff — read me first to resume

**Branch model:** `main` = production (both sites build from it), `dev` = preview. We push to
**`dev` + `main` only** (2 Cloudflare deployments). The old `claude/*` working branches are NOT
pushed anymore — two stray `claude/*` branches still exist on the remote and can be deleted from
GitHub (this environment's git can't delete remote branches). `main == dev` as of this handoff;
everything below is shipped, tested, and live-buildable.

**Shops:** Rico's (`ricos`, on `ricosyork.co.uk`) is set up and tested. **Food Station**
(`food-station`) is **not launched** — its `config.json` still has a placeholder Stripe
`connectedAccountId` + `TODO_` business fields (the build prints a loud warning for each).
Stripe is in **TEST** mode (test card `4242 4242 4242 4242`).

**Operators:** Rico's is in **per-operator mode** (named operators in `STAFF_LOGIN_KV` → `ops:index`).
Operator PINs are `HMAC-SHA256(SESSION_SECRET, pin)` — **do not change `SESSION_SECRET`** or every
operator PIN breaks. To drop back to the shared single PIN (legacy `STAFF_PIN_HASH`), delete the
`ops:index` key. Companion docs: `docs/AUDIT_FINDINGS.md` (full backlog + status),
`docs/PHASE2_APP.md` (Sunmi app), `app/README.md` (APK build).

## What was done last session
- **8-agent code audit → `docs/AUDIT_FINDINGS.md`**, then fixed ~all P0/P1 + most P2:
  pricing/refund money-paths (idempotent + order-bound), payment/webhook verification (PI-matches-
  order + constant-time HMAC), account hardening (enumeration + PBKDF2 DoS caps + session-invalidate-
  on-reset + PII), **order-bound single-use manager-override tokens**, operator last-owner/role
  guards, **keyed PIN hashing** (backward-compatible) + **CSRF/Origin gate** + lockout-clear,
  **slot-capacity enforcement**, build/templating hardening (JSON-escape, hard-fail on missing
  template / unknown token / placeholder config), cross-shop cart key, collection-checkout fix,
  Z-report refunded-total fix, and EPOS UI polish.
- **Product:** £15 **all-in** delivery minimum + "Minimum order £15" wording (per-shop flag
  `fulfillment.delivery.minimumIncludesFees`); **in-cart Collection/Delivery toggle**.
- **P2-9 CSP:** the build (`scripts/build-shop.js`) now **externalises every inline `<script>`** into a
  per-page same-origin `public/<page>.inlineN.js` and we dropped `script-src 'unsafe-inline'`.
  ⚠️ **Inline `on*=` event handlers are now CSP-forbidden** — don't add them; use `addEventListener`.
  (Inline `<script>` blocks are fine; the build auto-externalises them. `style-src 'unsafe-inline'`
  is intentionally kept.)
- EPOS verified end-to-end (login, roles, manager approval, refunds, Live lifecycle, Z/Today, counter
  sale). Deploys cleaned up to 2 (main + dev).

## NEXT (the T2 has arrived)
**Sunmi T2 native app.** Scaffold + hardening in `app/` (`docs/PHASE2_APP.md`, `app/README.md`).

**✅ Item 3 — app hardening DONE in code, verified headless (`app/scripts/native-test.cjs`), on-device test pending:**
- token + base URL → `@capacitor/preferences` (async bootstrap; off `localStorage`, migrates legacy);
- fetch shim builds an explicit `RequestInit` (no more `Request`-as-init);
- `provision.js` `await`s the Preferences write before reload;
- shim **re-asserts over CapacitorHttp** so `Authorization`/`X-Client` always inject (verify on-device);
- Kotlin drawer uses the ESC/POS `sendRAWData` kick on the Sunmi printer service (printer wired too —
  needs the `com.sunmi:printerlibrary` Gradle dep);
- **CSP-regression blocker fixed:** `app/scripts/sync-web.mjs` now bundles the externalised
  `/staff/index.inlineN.js` into `app/www/staff/` — without it the bundled till had **no JS** (blank).
  (All changes are under `app/` → zero web-build impact; clean build of both shops confirmed.)

**✅ App rebranded to LumiPOS + friendlier setup (on `main`):** appName → "LumiPOS"; launcher
icon from the Lumin "L" mark via `@capacitor/assets` (source: `app/assets/icon.png` — replace
with the owner's exact square logo). New setup flow: **6-digit Restaurant ID + password** —
`provision.js` resolves the ID via a bundled `DIRECTORY` (ricos=`190059`, food-station=`833541`)
to the shop's `*.pages.dev` backend, then verifies the password at **`/api/staff/device-setup`**
(checks per-shop secret `TILL_SETUP_PASSWORD`, fail-safe 503 when unset, rate-limited). The old
"site address" entry is kept as a fallback so a till can't be locked out of setup. **Owner action:**
set `TILL_SETUP_PASSWORD` (different per shop) in each Cloudflare project, or the ID path stays
disabled (fallback only). Adding a shop = add its ID→URL to `DIRECTORY` + set its secret.

**📋 Live updates (push UI changes to tills without a reinstall) — scoped in
`docs/PHASE3_LIVE_UPDATE.md`.** Recommended: `@capgo/capacitor-updater` self-hosted (no monthly fee,
auto-rollback). One shared bundle serves all tills (UI is shop-agnostic). Owner decision pending:
where to host the bundle (dedicated Cloudflare Pages project vs R2). Must be built + tested on the T2
(it changes how the app loads its UI; auto-rollback keeps it safe). Menu/prices already update live.

**⏳ Still to do (need the Mac + T2 / a decision — can't be done from the sandbox):**
1. **Build/sign the APK** on a Mac, install on the T2, provision to the prod URL.
2. **Provision + token login** — confirm `X-Client: app` → bearer → `Authorization: Bearer` works
   on-device (server `resolveSession` accepts cookie OR bearer).
3. **Hardware** — cash + card counter sale, **printer**, **cash drawer** (drawer/printer need the
   Sunmi Gradle dep added first — `app/native/android/README.md` step 3).
4. **Stripe Terminal (Phase 3) — scoped in `docs/PHASE3_TERMINAL.md`. Reader DECIDED: BBPOS
   WisePOS E (purchased, awaiting delivery).** (The T2 isn't on Stripe's Tap-to-Pay list — no NFC.)
   Implementation waits for the reader so the full loop can be tested (Stripe **simulated reader**
   first). The server side — `/api/staff/terminal/connection-token` + a `card_present` PI (manual
   capture) + a two-step `counter_card` (create-pending → capture-on-confirm → paid), which also
   **closes P2-10** — is reader-agnostic and could be pre-built now if you want it ready on arrival.

## Remaining backlog (not blocking)
- **Food Station launch:** fill real Stripe `connectedAccountId` + `business.{legalName,companyNumber,
  email,domain}` in `data/shops/food-station/config.json` (build warns until done), then it's ready.
- **Optional:** regenerate `STAFF_PIN_HASH`/`MANAGER_PIN_HASH` to retire the legacy SHA-256 path:
  `printf %s "<PIN>" | openssl dgst -sha256 -hmac "<SESSION_SECRET>"`. Current PINs work regardless.
- **Optional:** a global login attempt cap (per-IP + clear-on-success shipped; a global cap has a
  self-DoS trade-off).
- **Cleanup:** delete the two stray `claude/*` branches on GitHub.
- **Dropped (won't-fix):** P2-11 (operator-PIN PBKDF2 conflicts with the single-read login),
  P2-37 (Live countdown minute-resolution).

## Gotchas
- **`*.pages.dev` is FIREWALLED on this Cloudflare** — `ricos.pages.dev` etc. return `403 "Host not
  in allowlist"`. Only the **custom domains** are reachable (Rico's = `https://ricosyork.co.uk`). The
  app's shop DIRECTORY (`app/web/provision.js`) and any provisioning URL MUST use custom domains.
- **Sunmi T2 app = bundled universal app** (one APK, provisioned per shop via "Set up this till" / a
  6-digit Restaurant ID → custom domain; cross-origin via CapacitorHttp + bearer token). A `server.url`
  pivot was tried + **reverted** (owner wants the universal app). `native.js` now fails safe: bootstrap
  read is timeout-raced (can't freeze), relative `/api` calls are rejected + setup is forced when not
  provisioned (no fail-open/stall), requests time out, and an on-screen `diag` banner surfaces errors
  (the T2 has no remote console — USB debugging is locked by Sunmi). **Still TODO (fleet safety):**
  transpile the staff inline JS — it uses `?.`/`??` which break on WebViews older than the test T2's.
- **Push `dev` + `main` only** — pushing a `claude/*` branch makes a 3rd Cloudflare deploy.
- **`/api/config` is cached ~30s** (+ edge) — hard-refresh after a config change.
- Operator PINs are tied to `SESSION_SECRET`; clearing `ops:index` reverts to the shared PIN.
- The build **hard-fails** on a missing template or unknown `{{token}}` and **warns** on placeholder
  Stripe/business config.
- One codebase, config-gated per shop (golden rule). Never commit `public/` or `data/_active/`.
- Risky changes (CSP, anything you can't runtime-test here) → push to **`dev` first**, verify the
  preview, then fast-forward `main`.

## How to resume
New chat → **"Read `docs/SESSION_HANDOFF.md`, we're on `main` — let's build & test the Sunmi T2 app."**
