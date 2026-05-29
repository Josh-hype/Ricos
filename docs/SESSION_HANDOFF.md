# Session handoff — EPOS (read me first to resume)

**Branch:** `dev` (staging; Cloudflare builds it as a preview). `main` = live, untouched.
All work below is committed + pushed to `dev`. Companion docs:
`docs/EPOS_CAPABILITIES.md` (full roadmap), `docs/EPOS_UI_UPGRADE.md` (UI research +
plan), `docs/PHASE2_APP.md` (Sunmi app). Project rules: `CLAUDE.md`.

## What was built this session
1. **Auth hardening (Phase 1)** — per-operator identity in `STAFF_LOGIN_KV`
   (`_lib/operators.js`), roles/permissions enforced server-side (`_lib/permissions.js`),
   manager-override approval tokens, append-only audit log + viewer (`_lib/audit.js`,
   `api/staff/me|operators|authorize|audit`), idle sign-out, PIN lockout, sales
   attribution. Back-compatible (no operators set up ⇒ legacy single-PIN behaviour).
2. **Token auth** — `resolveSession()` accepts cookie (web) OR `Authorization: Bearer`
   (app); `login` returns the token only when `X-Client: app`. `test/auth.test.mjs`
   (run `node test/auth.test.mjs`, 14/14). Hardened token readers vs malformed tokens.
3. **Sunmi T2 app scaffold (Phase 2)** — Capacitor wrapper in `app/` (one APK +
   per-device provisioning), native bridge stub (printer/drawer/Tap-to-Pay),
   `CapacitorHttp`, web sync pipeline. Builds to an APK on a Mac (see `app/README.md`).
4. **UI overhaul (passes 1–A)** — design tokens/contrast/touch/typography; category
   colour-coding + options pill + chip modifier choices; required-first options + live
   "Add · £X"; payment redesign (Card-manual tender, UK quick-cash, amount-stamped
   confirm, colour-coded change, "Give change £X", drawer hook, correct Today/Z card
   split); Live card ageing colours + "ready in X min/over" countdown + correct
   card/cash pill; global `[hidden]` fix.

## Remaining / next (priority order)
1. **#6 Live → full Kanban columns** (New·In Prep·Ready·Out) — the one big rewrite left;
   touches the live-order pipeline (poll/alarm/accept/refund). **Do as its own tested
   pass** (verify on preview/T2), not blind. Card-level quality is already done.
2. **#7 polish** — onboarding stepper (Mode›Customer›Items›Pay), add-to-order total
   bump, drawn-checkmark 3-state pay button. Low risk, optional.
3. **Spice/meal pickers** stay as dropdowns (owner preference) — don't re-chip them.
4. **On-device (when T2 power adapter arrives)** — build/sign APK (`app/README.md`),
   install, test provisioning + token login + cash/card sale + printer/drawer.
5. **Stripe Terminal Tap-to-Pay** (Phase 3) — `connection-token` endpoint + native
   flow → `counter_card` capture. Decide reader (WisePOS E vs T2 Tap-to-Pay vs QR).
6. **Parked: remote device mgmt + live-update channel** (Layer 1) + **Sunmi MDM** setup
   (owner) for screen control + APK push.
7. **Capability roadmap** (`docs/EPOS_CAPABILITIES.md`): cash/shift mgmt (float, X/Z,
   blind cash-up), manual discounts/comps (activates the `discount` gate), 86/availability,
   loyalty (web+counter), reporting suite, inventory.

## Gotchas to remember
- **Cloudflare Preview scope** must have `SESSION_SECRET` + the **5 KV bindings**
  (`ORDERS/CUSTOMERS/MARKETING/SLOTS/STAFF_LOGIN`) — missing ones = app/login failures.
- Each `dev` push makes a **new preview URL**; the emulator is provisioned via `server.url`
  to a fixed one — re-point it after big pushes, or use a stable branch alias.
- **Emulator needs internet** (a Mac VPN like NordVPN breaks it). Test the web UI in
  **Chrome** for speed; use the emulator/T2 only for app-shell + hardware.
- One codebase, config-gated per shop (golden rule #3); never fork; never commit
  `public/`/`data/_active/`.

## How to resume
New chat → "Read `docs/SESSION_HANDOFF.md`, we're on `dev`" → pick an item above
(e.g. "do the #7 polish" or "build the Kanban Live, I can test on the preview").
