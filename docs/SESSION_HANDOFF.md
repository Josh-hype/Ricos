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

## NEXT (the T2 has arrived — do this first)
**Sunmi T2 native app.** Scaffold is in `app/` (`docs/PHASE2_APP.md`, `app/README.md`). Build/sign the
APK on a Mac, install on the T2, provision to the prod URL, then:
1. **Provision + token login** — app sends `X-Client: app`, gets a bearer token, sends it as
   `Authorization: Bearer` (server `resolveSession` accepts cookie OR bearer). Confirm a real login.
2. **Hardware** — cash + card counter sale, **printer**, **cash drawer**.
3. **Apply the deferred app hardening** (details in `docs/AUDIT_FINDINGS.md` → "Native app"):
   - **token storage**: move bearer token + base URL from `localStorage` → `@capacitor/preferences`
     (encrypted). `app/web/native.js` reads them synchronously at IIFE — needs an async bootstrap.
   - **fetch shim** (`native.js`): it passes a `Request` object as the `init` arg of `new Request()`
     — build an explicit `RequestInit` instead.
   - `provision.js`: `await` the `Preferences.set` before `location.reload()` (https-only already shipped).
   - **verify `CapacitorHttp` interception order** vs the fetch shim, so `Authorization`/`X-Client`
     headers are actually injected (test on device).
   - **Kotlin drawer TODO** (`app/native/android/EposHardwarePlugin.kt`) references the wrong Sunmi
     API — use the ESC/POS `sendRAWData` drawer-kick (or the T2 drawer API).
4. Then **Stripe Terminal Tap-to-Pay (Phase 3):** `connection-token` endpoint + native flow →
   `counter_card` capture. Decide reader (WisePOS E vs T2 Tap-to-Pay vs QR).

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
