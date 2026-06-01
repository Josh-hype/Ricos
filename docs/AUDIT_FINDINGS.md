# Code Audit — Findings & Fix Backlog

**Date:** 2026-05-29 · **Branch:** `dev` (work happened on `claude/busy-cori-fNl5x`, identical to `dev`).
**Method:** a swarm of 8 parallel read-only audit agents, one per domain. Nothing in this
pass was changed — this file is the to-fix backlog. Pick items by ID (e.g. "do P0-1, P0-6").

> How to use: items are grouped by priority (P0 → P3). Each has a stable ID, severity,
> `file:line`, the defect + why it matters, a suggested fix, and which agent found it.
> Several P0/P1 items touch **shared code that builds BOTH live shops** — test more than one
> shop / check the Cloudflare preview before merging to `main` (golden rule: one codebase).

## Progress

Fixed, verified, and pushed to `dev` (worktree `claude/busy-cori-fNl5x`):

- **Batch 1 — backend logic & crash-guards** (`059dd9a`): P0-1, P1-1, P2-3, P3-7, P3-9, P2-1, P2-2, P2-4, P3-10.
- **Batch 2 — frontend bugs** (`e8d70ad`): P0-6, P0-7, P1-2, P1-10, P1-11, P1-12, P1-13, P2-31.
- **Batch 3 — build/templating & data** (`0ae0ea1`): P1-8, P1-9, P2-20, P2-21, P2-22, P2-23, P2-24, P2-25, P2-29.
- **Batch 4 — refund money-path** (`c4881df`): P0-2, P1-14.
- **Batch 5 — payments + account hardening** (`2b29f5c`, `f7125d3`): P1-6, P1-7, P3-31, P1-4, P1-5, P3-21, P3-23, P3-24, P3-25, P3-27, P3-32.
- **Batch 6 — operator/audit/counter-sale** (`ec975b3`): P0-5, P2-7, P2-10, P2-6 (partial — crypto suffix; full HMAC chain still TODO).
- **Batch 7 — build ops** (`8641bd3`): P0-8 (loud build warning; real values still pending), P2-26, P2-28.
- **Batch 8 — customer order UI** (`014abbb`): P2-16, P2-18.
- **Batch 9 — auth hardening** (`c1bf9e5`): P0-4 (keyed PIN hashing, backward-compatible + lockout-clear-on-success), P2-8 (CSRF/Origin gate).
- **Batch 10 — small cleanups** (`5702809`): P3-47, P3-41, F-27 (app https-only).
- **Batch 11 — override-token binding** (`fe064fd`): P0-3 (bind to order + single-use, server + staff UI).
- **Batch 12 — slot capacity** (`6588285`): P2-5 (enforce maxOrdersPerSlot at submit).
- **Batch 13 — session invalidation** (`f07963e`): P1-3 (password reset logs out other sessions).
- **Batch 14 — EPOS UI polish** (`97e6035`): P2-33 (44px touch target), P2-36 (pay-modal default-hidden).

Each batch was verified with targeted Node unit checks (totals, refund ledger, PI-match,
phone/id normalisation, operator guards) plus the 14/14 auth regression and a clean build of
both shops. Rico's customer-visible output is byte-identical where intended.

**Needs YOU (can't complete unilaterally):**
- **P0-8 values (Food Station)** — real Stripe `connectedAccountId` + business `legalName` /
  `companyNumber` / `email` / `domain`. Deferred until we work on Food Station specifically (per
  owner); the build warns loudly until then.
- **P0-4 PIN-hash regen** — keyed hashing now ships *backward-compatibly* (existing hashes still
  work). To retire the weak SHA-256 path, regenerate each env var to the keyed value and update it
  in Cloudflare: `printf %s "<PIN>" | openssl dgst -sha256 -hmac "<SESSION_SECRET>"` → set
  `STAFF_PIN_HASH` and `MANAGER_PIN_HASH`. (Lockout-clear-on-success already shipped; a global
  attempt cap is left to you — it carries a self-DoS trade-off.)

**Done since (Batches 11–14):** P0-3 (override token bound to order + single-use), P1-3 (session
invalidation on reset), P2-5 (slot capacity), P2-8 (CSRF/Origin), P0-4 (keyed hashing + lockout-clear),
P2-33/P2-36 (EPOS touch target + pay-modal default-hidden).

**Won't-fix / blocked (documented):**
- **P2-9** drop CSP `'unsafe-inline'` — the app JS lives in large inline `<script>` blocks and the HTML
  is served statically (no per-response nonce possible), so this needs the inline JS extracted to
  external `.js` files first. A real refactor; there are zero inline event handlers, so the path is
  clean when tackled.
- **P2-11** operator-PIN PBKDF2 — conflicts with the single-KV-read reverse-index login (PBKDF2's
  per-user salt isn't deterministic). The current keyed HMAC already resists offline cracking — leaving.
- **Native app** (token → encrypted Preferences, fetch-shim `Request` init, CapacitorHttp ordering) —
  needs on-device testing; deferred to the Sunmi T2 app pass (https-only already shipped).
- **EPOS UI polish still open (low value):** P2-34 (sale menu cached for the session), P2-35 (ticket
  sub-header always "· cash"), P2-37 (countdown 1-min resolution). Do on request.

**Resolved as by-design (owner confirmed):**
- **P2-27** — Rico's `wings-platter` / `mega-wings` cross-listed under both Wings and Platters is
  **intentional** (the two files agree, so there was never an active bug). No change — don't re-flag.

**Left deliberately (no-op / design):** P2-17 (radius lowest-band preview is a documented choice)
and P2-19 (the 50p service-fee fallback equals both shops' real fee).

**Remaining P3 cosmetics (optional):** a11y `aria-label`s on cart/qty/item buttons, `alert()`→inline
notices, the Kotlin drawer-API TODO comment, etc. Say the word to knock these out.

## Coverage (what was audited)

| Agent | Scope |
|------|-------|
| Pricing/ordering | `totals.js`, `order.js`, `confirm.js`, menu/config loaders, delivery, geocode, postcode, hours |
| Auth/staff | `auth.js`, `operators.js`, `permissions.js`, `audit.js`, `customer-auth.js`, `_middleware.js`, all `staff/*` auth routes |
| Stripe/payments | `stripe.js`, `stripe-webhook.js`, refund/accept/status, `counter-order.js`, `wallet-domain.js` |
| Accounts/notify | signup/signin/signout/me/address/reset/forgot, `email.js`, `sms.js`, marketing, `kv.js` |
| Build/deploy | `build-shop.js`, templating/tokens, `manifest.json`, `.gitignore`, `package.json` |
| Shop data | `menu.json` ↔ `menu-visual.json` ID/price parity, `config.json` completeness (ricos, food-station, _template) |
| Staff EPOS UI | `templates/staff/index.html` (~3.6k lines) — payment/Live/modifier passes |
| Customer UI + app | `templates/order.html` (~3.6k lines), basket/checkout, Capacitor app wrapper |

## What's solid (verified, no change needed)

- **Price tampering is not possible.** The client only sends item IDs / qty / modifier IDs;
  `computeTotals()` recomputes every total from `menu.json`, and the Stripe PaymentIntent
  `amount` is fixed server-side at creation (`amountP: totals.totalP`, idempotency-keyed).
  Confirmed independently by the pricing and Stripe agents.
- **Stripe Connect routing is consistent** — the `Stripe-Account` header is applied uniformly
  on PI create / refund / retrieve / customer / PM calls; refunds target the same account that
  holds the charge; `application_fee_amount` only set when configured. No path sends money to
  the wrong account.
- **Customer password primitives are correct** — PBKDF2 (SHA-256, 16-byte salt) + timing-safe
  compare; reset tokens are HMAC-signed, 1h expiry, single-use (fingerprinted to the old hash);
  generic signin error; always-200 forgot-password. (Work-factor/timing nits are listed below.)
- **Shop menu data is clean** — every item ID and modifier/choice ID matches exactly between
  `menu.json` (pence) and `menu-visual.json` (pounds) in both shops; all prices numeric and
  non-negative; no cross-shop contamination. (Two caveats are in P2.)
- **EPOS money math holds up** — pay-modal change, refund line-share (`round(lineTotalP*(sub-disc)/sub)`),
  Today/Z card-vs-cash split, and the global `[hidden]` fix were all verified correct.
- **Payment-methods + wallet-domain endpoints** verify ownership before detach and register
  the PM domain on the connected account correctly.

---

# 🔴 P0 — fix first (money / breakage / security)

### P0-1 · High · `functions/_lib/totals.js:19` — fractional `qty` → non-integer pence
`const qty = Math.max(1, Math.min(20, Number(line.qty) || 1));` clamps the range but never
floors. `qty:2.9` → `lineTotalP:2595.5`, `totalP:2385.5`. A non-integer pence amount **breaks
the Stripe PaymentIntent** (amount must be an integer) and corrupts stored/cash totals.
**Fix:** `Math.max(1, Math.min(20, Math.floor(Number(line.qty)) || 1))`; consider rejecting
non-integer qty. *(Pricing #1)*

### P0-2 · High · `functions/api/staff/orders/[id]/refund.js:74`, `status.js:33` — refund under/over-refund
The Stripe idempotency key is derived from the **pre-refund** total (`refund_<intentId>_<prior>`),
and the KV read-modify-write (`getOrder → createRefund → recordRefund → putOrder`) is **not
atomic**. Two refunds issued before the first KV write commits both see `prior=0`, compute the
**same key**, and Stripe replays the first refund's result → the second records a phantom refund
(under-refund) or, when amounts/`prior` differ, concurrent refunds exceed the order total
(over-refund — `recordRefund` caps nothing). Auto-refund-on-cancel (`status.js`) shares the flaw
and can race a manual partial refund.
**Fix:** make the key unique per attempt (include `amount` + a per-request id/UUID stored on the
order); add optimistic concurrency (version/`refundSeq` re-read before write). Also fix the
related `refundApplicationFee: amount===total` heuristic (P1-13). *(Stripe #12, #13, #16)*

### P0-3 · High · `functions/_lib/permissions.js:71`, `auth.js:168` — manager-override token is replayable
The override approval token encodes only `{op, name, perm, exp}` — **no order ID, no amount, no
nonce, not single-use**. `requirePermission` accepts it on `auth.perm === perm` alone. So one
"approve refund" tap gives the logged-in staffer a **2-minute window to refund/void any order**,
replayable; a `*` (owner) approval authorises *every* gated action for 2 minutes.
**Fix:** bind the token to the specific `orderId` (+ amount/action hash) and verify it matches the
request; make it single-use via a `jti` recorded in KV with short TTL. *(Auth P1; interacts with
summary/audit S1)*

### P0-4 · High · `functions/_lib/auth.js:27,50-60`, `login.js:19` — brute-forceable staff/manager PINs
Staff (`STAFF_PIN_HASH`) and manager (`MANAGER_PIN_HASH`) PINs are verified as **unsalted
SHA-256** over a 4–8 digit space (10⁴–10⁸). Lockout is **per-IP only** (`cf-connecting-ip`,
8/10min), so a distributed attacker bypasses it; and the three surfaces use *separate* IP buckets
(`attempts:`, `mgr-attempts:`, `authz-attempts:`) despite `manager-login.js`'s comment claiming a
shared bucket. A leaked hash is cracked instantly.
**Fix:** key the PIN hash with `SESSION_SECRET` (HMAC, as `operators.js` already does) or
PBKDF2/scrypt + salt; add a per-operator **and** global attempt cap with backoff; reconcile the
rate-limit comment (L2). *(Auth A1, L1, L2)*

### P0-5 · High · `functions/api/staff/operators/[id].js`, `operators.js` — no last-owner / role-ceiling guards
Anyone with `operators.manage` can **demote/deactivate the last owner** (locks the business owner
out), **self-demote**, or **mint new `owner`s** (role isn't capped to the actor's level — a
`manager` can create an `owner`). Worse, **bootstrap** (`operators/index.js:14`) lets *any*
authenticated staff session create the first operator while none exist — so anyone holding the
shared till PIN can create an `owner` and flip the shop into operator mode.
**Fix:** refuse to deactivate/demote the last active owner; forbid granting a role above the
actor's; gate first-owner creation behind the manager PIN / a setup token. *(Auth O1, P2)*

### P0-6 · High · `templates/order.html` (`STORAGE_KEY`), `templates/basket-bar.html:20` — cross-shop cart leakage
The `localStorage` cart key is hardcoded **`'ricos.v1'`** in both files. On the Food Station site
in the same browser, the basket bar/order page read **Rico's cart** (wrong items & prices) — a
multi-tenant data-leak / money-display bug.
**Fix:** shop-scope the key, e.g. `'{{shopSlug}}.v1'`, substituted by the build in both files.
*(Customer F-23)*

### P0-7 · High · `templates/order.html:2944` — collection checkout blocked by postcode guard
`startCheckout` guards with `if (!state.postcode)` for **both** modes, so a **collection**
customer (no delivery address needed) is blocked with "Please enter your postcode". The address
*step* is already correctly skipped for collection; only this guard is wrong.
**Fix:** `if (state.mode === 'deliver' && !state.postcode)`. *(Customer F-03 — verify in-code before shipping)*

### P0-8 · Critical (config/ops) · `data/shops/food-station/config.json` — Food Station not launch-ready
`stripe.connectedAccountId` is still the literal `"acct_REPLACE_WITH_STRIPE_CONNECT_ID"`, so
**every Food Station card payment fails**. `business.{legalName, companyNumber, email, domain}`
are `TODO_…` placeholders that render verbatim into customer emails/receipts/legal pages.
**Reconciliation:** despite CLAUDE.md implying Food Station is live, its config says otherwise.
**Fix:** supply the real Stripe Connect account ID + business fields (owner action). *(Data #6, #7)*

---

# 🟠 P1 — high

### P1-1 · `functions/_lib/totals.js:117` — empty cart accepted
The "Cart is empty" guard is `if (totalP <= 0)`, but `totalP = subtotal + delivery + serviceFee`
and `serviceFeePence` is 50, so a **zero-item order has `totalP:50`** and gets created/charged.
`/api/order` doesn't pre-check item count either.
**Fix:** `if (lines.length === 0 || subtotalP <= 0) return { ok:false, reason:'Cart is empty.' }`
before adding fees. *(Pricing #2)*

### P1-2 · `templates/order.html` (`startCheckout` sign-in poll) — double checkout submit
The 200ms poll watching for sign-in/guest choice isn't stored in a clearable variable. A
double-tap on Checkout (or re-entry before the overlay closes) creates a second interval; both
fire and `runCheckout()` can run twice.
**Fix:** store the interval id on a module-scoped var, clear any existing one before starting,
disable the checkout button during the account prompt. *(Customer F-04)*

### P1-3 · `functions/_lib/customer-auth.js:102` — stolen session survives password reset
Customer sessions are stateless 30-day HMAC tokens carrying only `{c, exp}` — no password
version/fingerprint. Resetting the password does **not** invalidate other outstanding sessions, so
a stolen cookie keeps full access for up to 30 days.
**Fix:** include a `pwVersion`/hash-slice (`fp`, as reset tokens already do) in the session payload
and check it in `readCustomerSession`. *(Auth C2 + Accounts #2 — two agents)*

### P1-4 · `signup.js:24`, `reset-password.js:16`, `customer-auth.js:84` — unbounded password → PBKDF2 DoS
Only a **minimum** length is enforced; a multi-MB password forces proportional PBKDF2 work
(100k iterations) on unauthenticated endpoints, within the Workers CPU budget.
**Fix:** reject passwords over ~128–1024 chars before hashing. *(Accounts #5 + Auth C4)*

### P1-5 · `signup.js:27`, `signin.js:20`, `forgot-password.js:24` — account enumeration
Signup returns **409 "already exists"** (confirms a contact is registered). Signin/forgot only
run PBKDF2 / send email when the account **exists**, so response timing leaks existence despite the
identical error text.
**Fix:** run a dummy PBKDF2 on signin-miss; `ctx.waitUntil(sendEmail(...))` (return immediately) on
forgot; return a generic 200 on duplicate signup (and email "you already have an account").
*(Accounts #3, #4, #6)*

### P1-6 · `functions/_lib/kv.js` (`recordOptIn`) — missing `MARKETING_KV` crashes paid-order recording
`recordOptIn` calls `env.MARKETING_KV.put(...)` with no binding guard. If `MARKETING_KV` is unbound
(easy for a new shop), it throws **uncaught** — crashing not only `/api/marketing/subscribe` but
**`markOrderPaid`** (a successfully-paid order 500s while recording the opt-in).
**Fix:** `if (!env.MARKETING_KV) { console.warn(...); return; }` at the top of `recordOptIn`; add
explicit null guards in `markOrderPaid` (P3). *(Accounts #16)*

### P1-7 · `api/stripe-webhook.js:13`, `confirm.js:26`, `stripe.js:194` — weak payment-promotion verification
Both promote an order to paid on PI `succeeded` **without** checking `amount_received`/`currency`/
`pi.id === order.payment.intentId` (orderId is free-form metadata). And the webhook HMAC is
compared with non-constant-time `!==` (a `timingSafeEqual` helper already exists in `auth.js`).
**Fix:** assert `pi.id === intentId` (cheapest/strongest) + `amount_received >= totalP` + `gbp`
before `markOrderPaid`; switch the HMAC compare to the constant-time helper. *(Stripe #1, #5 +
Pricing #14 — three agents)*

### P1-8 · `templates/staff/manifest.json:2` — PWA manifest not JSON-escaped
`shopName`/`shopShortName` are substituted raw into JSON string values. Any future shop name with a
`"` produces malformed JSON → the staff PWA install **silently fails**. (Rico's apostrophe is valid
JSON; a quote isn't.)
**Fix:** JSON-encode string tokens when the output file is JSON, or build the manifest via
`JSON.stringify`. *(Build T1)*

### P1-9 · `package.json:11` — `deploy`/`tail` hardcode `--project-name=ricos`
Running either from a Food Station context hits **Rico's** Cloudflare project / logs. Multi-tenant
footgun.
**Fix:** parameterise via `SHOP_SLUG`, or remove (deploys go through Cloudflare CI) and document.
*(Build P1)*

### P1-10 · `templates/staff/index.html:1426,1577` — staff state not reset on re-login → missed alarms
The logout handler never clears `state.seenIds / orders / operator / perms / operatorsEnabled /
lastLiveSig`. After Switch-Operator or re-login, `seenIds` still contains prior order IDs, so any
order that was `pending_accept` before sign-in **never triggers the new-order alarm** for the new
operator.
**Fix:** reset those state fields in the logout handler. *(Staff F-003)*

### P1-11 · `templates/staff/index.html:1170,1905,2099,2292` — undefined `var(--grey)` hides delivery address
`var(--grey)` is never defined in `:root`, so it falls back to transparent/inherited — making the
**delivery address text invisible** on order cards and the alarm popup (driver/kitchen can't read
it).
**Fix:** map to `var(--muted)` (defined `#5C6B82`) or add `--grey:var(--muted)`. *(Staff F-001)*

### P1-12 · `templates/staff/index.html:3056` — quick-cash buttons vanish for exact-note totals
`renderQuickCash` hardcodes `[2000,5000]` and excludes any candidate `> totalP`. A **£50.00** order
shows only "Exact" (no £50 button); £20.00 shows only £50. Cashier must hand-key the note.
**Fix:** `const notes=[500,1000,2000,5000]; const denoms=new Set(notes.filter(n=>n>totalP).slice(0,3));`
guarantees ≥1 note button for any total ≤ £50. *(Staff F-004)*

### P1-13 · `templates/staff/index.html:2885` — meal-upgrade price label uses visual (pounds) not canonical
The "+£X" meal label reads `v.meal.addPrice` (display, pounds) while `recalc`/`lineUnitP` use
canonical `mealAddP` (pence). If the two files drift (a known gotcha), the label disagrees with the
live total — staff quote the wrong price.
**Fix:** drive the label from `(canonical.mealAddP||0)/100`. *(Staff F-007)*

### P1-14 · `functions/api/staff/orders/[id]/refund.js:73` — application-fee refund heuristic
`refundApplicationFee: prior===0 && amount===total` returns the platform fee only on a *first full*
refund. A full refund assembled as the *last* of several partials (`prior>0`) keeps the fee even
though the customer got 100% back; a partial that happens to equal `total` wrongly refunds the fee.
**Fix:** decide on `prior + amount >= total` + a `feeRefunded` flag to avoid double-refund.
*(Stripe #14)*

---

# 🟡 P2 — medium

## Config robustness (a routine per-shop edit can 500 a live endpoint)
- **P2-1 · `functions/_lib/hours.js:43,79`** — `isOpenNow`/`listSlots` throw `TypeError` if a day has
  `closed:false` but no `windows`. A single config typo 500s ordering **and** `/api/config`.
  Fix: `const windows = Array.isArray(today.windows) ? today.windows : []`. *(Pricing #7)*
- **P2-2 · `functions/_lib/postcode.js:12`** — `isOutcodeAllowed` throws when `allowedOutcodes` is
  undefined (default mode is `outcode`; a new shop can omit it). 500s `/api/delivery-quote` + delivery
  orders. Fix: `if (!Array.isArray(allowed)) return false;`. *(Pricing #9)*
- **P2-3 · `functions/_lib/totals.js:93`** — caller-supplied `deliveryFeeP` is used on a bare
  `!= null` check; `NaN`→`totalP:null`, negative→undercharge. The self-contained branch already
  guards with `Number.isFinite`; this one doesn't. Fix: `Number.isFinite(x) && x>=0`. *(Pricing #3)*
- **P2-4 · `functions/_lib/config.js:13-44`** — `getPublicConfig` dereferences `business.*`,
  `fulfillment.collection.*`, `payments.*` without guards (unlike its defensive siblings). An
  incomplete config 500s `/api/config`. Fix: optional-chain or validate config shape at build time.
  *(Pricing #16)*

## Capacity / concurrency
- **P2-5 · `functions/_lib/hours.js` + `kv.js:141,149`** — `maxOrdersPerSlot` (set to 6 in both
  configs) is **never enforced**: `getSlotCount` has zero callers, `listSlots`/`isSlotValid` ignore
  capacity, and `incrSlotCount` is a non-atomic TOCTOU read-modify-write. Slots can be over-booked.
  Fix: enforce capacity in `listSlots`/`isSlotValid` (make async / pass counts); accept or document
  the KV race (true atomicity needs a Durable Object). *(Pricing #15 + Accounts #19)*

## Auth / abuse hardening
- **P2-6 · `functions/_lib/audit.js:9`** — audit log is plain KV with no HMAC/hash-chain, so
  "append-only" isn't enforced; tampering is undetectable. The dedupe suffix uses `Math.random()`
  (same-ms collisions could overwrite). Fix: HMAC or hash-chain each entry; use
  `crypto.getRandomValues`. *(Auth AU1)*
- **P2-7 · `functions/_lib/audit.js:25`** — `listAudit` caps at 1000 keys with no cursor; because
  keys sort `audit:YYYY-MM-DD:…`, the cap drops the **newest** days, and the range filter runs after
  truncation (so "today" can return nothing). Fix: paginate with the cursor or list by day-prefix.
  *(Auth AU2)*
- **P2-8 · `functions/_lib/auth.js:122` + staff POST routes** — `SameSite=Lax` cookie with no CSRF
  token or `Origin`/`Referer` check. JSON POSTs are largely mitigated, but read endpoints are
  reachable via top-level navigation. Fix: add an Origin allowlist or move staff cookie to
  `SameSite=Strict` (the till is same-site). *(Auth A5)*
- **P2-9 · `functions/_middleware.js:19`** — CSP `script-src` includes `'unsafe-inline'`, so any
  HTML-injection (e.g. unvalidated operator `colour`, a template-token bug) can execute inline
  script. Fix: nonce/hash-based inline scripts; drop `'unsafe-inline'`; add `frame-ancestors 'none'`.
  *(Auth M1)*
- **P2-10 · `functions/api/staff/counter-order.js:46,105`** — `counter_card` records `state:'paid'`
  with **no capture**, gated only by `requireStaff` (no `sell` permission), and writes **no audit
  entry**, yet counts toward Today/Z card totals. Fix: gate on `requirePermission(...,'sell')`, add
  an audit entry, and only mark paid after a real capture once Terminal lands. *(Stripe #19)*
- **P2-11 · `functions/_lib/operators.js:25`** — operator PINs are unsalted single-iteration
  HMAC-SHA256 (no per-user salt → identical PINs share a hash via the `oppin:` index; no stretching).
  Better than P0-4 because keyed by `SESSION_SECRET`, but prefer PBKDF2/scrypt + salt. *(Auth A2)*

## Native app (`app/`)
- **P2-12 · `app/web/native.js:19`** — bearer token + base URL stored in plain `localStorage`
  (JS-readable in the WebView; risk if the planned live-update channel is unsigned). Fix: use
  `@capacitor/preferences` (encrypted) — `provision.js` already does for the base URL. *(Customer F-24)*
- **P2-13 · `app/web/native.js:34-46`** — fetch shim passes a `Request` object as the `init` arg of
  `new Request(url, input)` (not spec-compliant; can drop body/headers in strict WebViews). Fix:
  build an explicit `RequestInit`. *(Customer F-25)*
- **P2-14 · `app/capacitor.config.json:13`** — `CapacitorHttp` may intercept `fetch` **before**
  `native.js` patches `window.fetch`, dropping the injected `Authorization`/`X-Client` headers.
  Fix: verify interception order on-device, or call `CapacitorHttp.request()` directly with explicit
  headers. *(Customer F-31)*
- **P2-15 · `app/web/provision.js:37,43`** — provisioning regex allows `http://` (plaintext token
  transport); the Preferences `set` isn't awaited before `location.reload()` (slow device may lose
  the write). Fix: require `https://`; `await` then reload. *(Customer F-27, F-28)*

## Customer UI
- **P2-16 · `templates/order.html:3553`** — switching pay method to Cash hides the card/saved-card
  sections but **not** the Express/Apple-Pay section; clicking a wallet button then places a **card**
  order (`req.paymentMethod='card'`), bypassing the cash choice. Fix: hide
  `#express-checkout-section` on Cash. *(Customer F-17)*
- **P2-17 · `templates/order.html:2039`** — radius shops preview the **cheapest** delivery band
  before a postcode is entered (and the min-order check uses that too low fee). Fix: show "TBD —
  enter postcode" until confirmed. *(Customer F-06)*
- **P2-18 · `templates/order.html:2063` + `basket-bar.html:24`** — cart totals accumulate in
  floating-point pounds (`price*qty`, discount `sub*pct/100`) → ≤1p display drift vs what Stripe
  charges (server is authoritative). Fix: do cart math in integer pence, divide by 100 only at
  display. (Root cause of several Low display nits.) *(Customer F-01)*
- **P2-19 · `templates/order.html:2037`** — service fee falls back to `0.50` before
  `window.SHOP_CONFIG` loads; if the real fee differs, the pre-payment total disagrees with the
  charge until config loads. Fix: suppress/"loading…" until config is in. *(Customer F-07)*

## Build / templating
- **P2-20 · `scripts/build-shop.js:272`** — a missing template file → `console.warn` + exit 0, so a
  broken site deploys silently (e.g. deleted `order.html` → no `/order`). Fix: error + `exit(1)` for
  required templates; warn on missing basket-bar. *(Build B2)*
- **P2-21 · `scripts/build-shop.js:252`** — an unknown `{{token}}` is left **verbatim** in output
  (exposes internal names / breaks the page) with only a warning. Fix: hard-error in dev, or replace
  with empty string. *(Build B3)*
- **P2-22 · `scripts/build-shop.js:128`** — assets copy uses flat `copyFileSync`; a subdirectory in
  `assets/` throws `EISDIR` and crashes the build with a raw stack trace. Fix: `statSync().isFile()`
  filter or recursive copy. *(Build B4)*
- **P2-23 · `scripts/build-shop.js:43` + `register-wallet-domain.mjs:33`** — `SHOP_SLUG` / argv slug
  is path-joined with only an `_`-prefix check (no charset allowlist) → `../` traversal possible.
  Fix: `if (!/^[a-z0-9-]+$/.test(slug)) exit(1)`. *(Build B1, R1)*
- **P2-24 · `templates/staff/manifest.json:8`** — `background_color`/`theme_color` hardcoded to
  Rico's palette; Food Station's PWA shows Rico's chrome. Fix: use `{{themeBackground}}` /
  `{{themePrimaryDeep}}`. *(Build T2)*
- **P2-25 · `templates/order.html:7`** — `<meta name="description">` hardcodes "10% off all online
  orders" for **every** shop; Food Station has the promo disabled (false advertising in SEO). Fix:
  conditional `{{promoTagline}}` or drop the claim. *(Build T3)*
- **P2-26 · `public/lumin-epos-preview.html`** — a dev-only UI mockup is committed on `main` and
  served publicly at `/lumin-epos-preview.html` on **both** live sites. Fix: `git rm` it (and
  gitignore) or move to `docs/`. *(Build G2)*

## Shop data
- **P2-27 · `data/shops/ricos/menu.json` + `menu-visual.json`** — `wings-platter` and `mega-wings`
  each appear in **two** categories (`wings` + `platters`). Copies are byte-identical today (no
  mispricing) but `indexMenu()` is last-write-wins and the item renders twice; they'll silently
  diverge if one copy is edited. Fix: pick a canonical category, or give distinct IDs. *(Data #1)*
- **P2-28 · `data/shops/_template/`** — no `logo.png`, but CLAUDE.md says the build **fails without
  it**, so `cp -r _template …` + build fails immediately for any new shop. Fix: ship a placeholder
  `logo.png` (or document loudly in the template README). *(Data #8)*
- **P2-29 · `data/shops/_template/config.json`** — ships `promo.autoOnlineDiscount.enabled:true`
  (10%), so a new shop copied from the template **silently gives 10% off** from day one. Fix: default
  to `false` with a comment. *(Data #10)*

## Staff EPOS UI
- **P2-30 · `templates/staff/index.html:1314,2896`** — duplicate DOM id `itemTitle` (static on the
  modal + dynamically injected `<h2>`); `getElementById` returns the wrong one and AT is confused.
  Fix: use a class for the injected title / point `aria-labelledby` at `#itemBody`. *(Staff F-006)*
- **P2-31 · `templates/staff/index.html:210,903` (+ dead `:902-911`)** — the `.chip` class is defined
  twice; the modifier-chip rules override and visually break the topbar status `.chip.live` (turns a
  38px status pill into a 44px tappable-looking one). The chip CSS is also **dead code** (spice/meal
  reverted to dropdowns). Fix: delete the orphaned `.chips`/`.chip` rules (or rename to `.mod-chip`).
  *(Staff F-008, F-010)*
- **P2-32 · `templates/staff/index.html:995,1497`** — nav tablist never sets `aria-selected` when
  `setView` toggles `.active`. Fix: set `aria-selected` per tab in `setView`. *(Staff F-009)*
- **P2-33 · `templates/staff/index.html:392`** — the `⋮` card-menu button is ~26×28px (below the
  44px touch target) — hard to hit on the Sunmi T2. Fix: `min-width/height:44px`. *(Staff F-011)*
- **P2-34 · `templates/staff/index.html:2423`** — `initSaleView` skips reload while `sale.ready`
  (set once, never cleared), so a mid-shift menu change shows stale names/prices on the till tiles
  (money is fine; server recomputes). Fix: TTL or reload on new session. *(Staff F-013)*
- **P2-35 · `templates/staff/index.html:2523`** — `modeSubLine()` always appends "· cash" regardless
  of the tender actually selected in the pay modal (ticket sub-header misleads staff). Fix: reflect
  the chosen tender. *(Staff F-015)*
- **P2-36 · `templates/staff/index.html:1352`** — `#payAmount/#payChange/#payQuickCash/#payPad` have
  no `hidden` in source; they're only hidden by `setTender('card')`. Works today (default is cash)
  but brittle. Fix: add `hidden` in the HTML so the initial state is unambiguous. *(Staff F-014)*
- **P2-37 · `templates/staff/index.html:1645`** — `liveSignature` includes `agingMins` (minute
  resolution), so the "ready in X min" countdown only updates ~once/minute and the soon→over
  transition is ±1 min. Fix: separate 60s render tick for active cards. *(Staff F-012)*

---

# ⚪ P3 — low (hardening, edge cases, a11y, style)

Grouped; each is `file:line — one-liner (source)`. Expand on request.

**Stripe/payments**
- P3-1 · `stripe.js:183` — webhook parses only one `v1=`; multi-signature headers (secret roll) can be rejected. *(Stripe #2)*
- P3-2 · `stripe-webhook.js:10` — assumes per-account (not platform) webhook registration; add a comment or check `event.account`. *(Stripe #6)*
- P3-3 · `confirm.js:12` — unauthenticated + short (7-char) order IDs make a "is order X paid?" oracle. *(Stripe #8)*
- P3-4 · `stripe.js:101` — self-heal retry reuses idempotency key `pi_<orderId>` with changed params → possible Stripe 400. *(Stripe #10)*
- P3-5 · `status.js:38` — order can end cancelled-but-not-refunded (only flagged `refundFailed`, no retry; "cancelled" email still sent). *(Stripe #17)*
- P3-6 · `wallet-domain.js:18` — gated by `requireStaff` not `operators.manage` (consistency). *(Stripe #22)*

**Pricing/ordering**
- P3-7 · `totals.js:25` — modifier IDs summed without dedup; harmless now, but a future negative `priceDeltaP` repeated would undercharge. *(Pricing #4)*
- P3-8 · `totals.js:24` — required option groups / meal `count` not enforced server-side (order can miss a mandatory dip). *(Pricing #5)*
- P3-9 · `totals.js:82` — promo `percent` unbounded; `>100` makes net negative (config-only). *(Pricing #6)*
- P3-10 · `delivery.js:42` — radius `bands` sort/compare break if `maxMiles` is a string (config-only). *(Pricing #11)*
- P3-11 · `postcode.js:7` — regex rejects `GIR 0AA` (irrelevant to York/Easingwold). *(Pricing #10)*
- P3-12 · `geocode.js:9` — unbounded in-isolate cache (practically bounded by catchment). *(Pricing #12)*
- P3-13 · `hours.js:121` — `isSlotValid` rebuilds the whole slot grid just to `includes` (perf). *(Pricing #8)*

**Auth / accounts**
- P3-14 · `auth.js:75` — stateless tokens have no `kid`/version → secret rotation invalidates all; no revocation; **operator deactivation isn't immediate** (≤12h). *(Auth A3)*
- P3-15 · `auth.js:201` — `requireManager` reads cookie only → the bearer/app path can't satisfy it (legacy-mode app can't see summary/audit). *(Auth A6)*
- P3-16 · `operators.js:113,80` — `colour` stored without hex validation (9 chars; stored-XSS depending on sink). *(Auth O3)*
- P3-17 · `permissions.js:13` — `sell`/`drawer.open`/`cash.manage`/`discount` defined but enforced nowhere (latent as roles narrow). *(Auth P3)*
- P3-18 · `customer-auth.js:11` — PBKDF2 at 100k is below current (~600k) guidance; per-record so upgrade-friendly. *(Auth C1 / Accounts)*
- P3-19 · `customer-auth.js:113,150` — token split relies on the undocumented "b64url has no dot" invariant; use `indexOf('.')`. *(Accounts #1)*
- P3-20 · `me.js:12` — a valid session whose customer was deleted returns `{user:null}` without clearing the cookie. *(Accounts #8)*
- P3-21 · `reset-password.js:21` — missing-account returns 404 vs 400 (leaks that the token was valid). *(Accounts #11)*
- P3-22 · `signout.js:5` — accepts unauthenticated callers, no session read/log. *(Accounts #10)*

**Validation / notify**
- P3-23 · `signup.js:18` — no max `name` length (flows into email HTML). *(Accounts #7)*
- P3-24 · `address.js:16` / `customer.js:60` — no length caps on `line1/line2/city/postcode`. *(Accounts #9)*
- P3-25 · `email.js:33` — logs the raw Resend error body (may contain the recipient email — PII in Workers logs). *(Accounts #12)*
- P3-26 · `email.js:140` — `escapeHtml(resetUrl)` turns `&` into `&amp;` in the copy-paste plain-text link. *(Accounts #13)*
- P3-27 · `sms.js:35` — `+44` numbers accepted with no upper length bound. *(Accounts #14)*
- P3-28 · `sms.js:24` — `sendSms` returns `{error}` silently (future callers may miss failures). *(Accounts #15)*
- P3-29 · `subscribe.js` — **no double opt-in**: anyone can subscribe any third party's email/phone (UK PECR/GDPR). Consider confirmed opt-in or require a session. *(Accounts #17 — borderline P1 for compliance)*
- P3-30 · `subscribe.js:11` / `kv.js:157` — redundant double-lowercase of email. *(Accounts #18)*
- P3-31 · `kv.js:36` — `markOrderPaid` relies on `recordOptIn`'s internal null guard for email/phone. *(Accounts #20)*
- P3-32 · `customer.js:18` — modulo bias in `newCustomerId` (36-char alphabet; negligible). *(Accounts #21)*

**Build / deploy / docs**
- P3-33 · `build-shop.js:119,143` — `JSON.parse` without try/catch (unhelpful stack trace, no file/shop name). *(Build B5)*
- P3-34 · `build-shop.js:191` — 5 dead tokens provided but unused (`shopCompanyNumber`, `shopDomain`, `shopEmail`, `shopFullAddress`, `shopLegalName`). *(Build B6)*
- P3-35 · `package.json:9` — `postinstall` double-builds on Cloudflare and can fail `npm install`; consider removing. *(Build P2)*
- P3-36 · `package.json` — no `engines` field (CLAUDE.md says Node 20). *(Build P3)*
- P3-37 · `CLAUDE.md:60` — wrongly lists `privacy.html`/`terms.html` as "static committed"; they're generated (and `allergy-info.html` is unlisted). Update the doc. *(Build G1)*

**Shop data**
- P3-38 · `data/shops/food-station/menu-visual.json` (drinks) — Coke Zero/Fanta Lemon/7Up/Dr Pepper/Monster lack a size option; confirm can-only is intended. *(Data #3)*
- P3-39 · `data/shops/ricos/config.json` — `fulfillment.delivery.mode` absent (defaults `outcode`; make explicit). *(Data #4)*
- P3-40 · `data/shops/ricos/config.json` — comment says "LIVE Stripe" while CLAUDE.md says TEST; verify the Cloudflare key matches the account's live/test state. *(Data #5)*

**Customer UI / app**
- P3-41 · `order.html:2567` — dead ternary `accountTab = state.user ? 'signin' : 'signin'`. *(Customer F-12)*
- P3-42 · `order.html:2941,3105` — uses native `alert()` for empty-cart/address vs inline notices elsewhere. *(Customer F-15)*
- P3-43 · `order.html:1552` — `POSTCODE_REGEX` doesn't escape the substituted area prefix. *(Customer F-16)*
- P3-44 · `order.html:1409` — mode-toggle `aria-selected` set in HTML before `applyMode` runs (brief wrong announcement). *(Customer F-11)*
- P3-45 · `order.html:1843,2081` — item-add / qty buttons lack item-specific `aria-label`. *(Customer F-19, F-20)*
- P3-46 · `reset-password.html:124` — on missing token, shows a disabled form rather than collapsing it. *(Customer F-22)*
- P3-47 · `landing-default.html:11` — hardcodes the Google Fonts link instead of `{{fontLink}}` (ignores per-shop font). *(Customer F-21)*
- P3-48 · `app/scripts/sync-web.mjs:45` — idempotence check string-matches `./native.js` (fragile). *(Customer F-29)*
- P3-49 · `app/native/android/EposHardwarePlugin.kt:42` — drawer TODO references a likely-wrong Sunmi API (`openDrawer()` vs ESC/POS `sendRAWData`). *(Customer F-30)*

**Staff UI**
- P3-50 · `staff/index.html:884,911` — `:has()` selector for selected-choice highlight may not work on older Sunmi WebView (<105); add a JS class fallback. *(Staff F-018)*
- P3-51 · `staff/index.html:2382` — `printOrder` doesn't expand a collapsed card body before `window.print()` ([hidden] applies in print too). *(Staff F-019)*
- P3-52 · `staff/index.html:1595,1605` — pin screen uses `style.display` while dashboard uses `[hidden]` (maintenance hazard). *(Staff F-023)*
- P3-53 · `staff/index.html:1655` — `seenIds` grows unbounded for the page session (negligible). *(Staff F-022)*
- P3-54 · `staff/index.html:2099,1884` — `canRefund` excludes `counter_card`; matters once Terminal (Phase 3) sets an `intentId`. *(Staff F-002)*
- P3-55 · `staff/index.html:2095` — alarm payment label falls through to "CASH on delivery" for `cash_delivery`/`counter_*` (only matters if those ever hit `pending_accept`). *(Staff F-005)*

---

## Notes / cross-agent corroborations
- **Refund concurrency** (P0-2) is the single highest-impact money defect — flagged across the
  Stripe agent's three findings and consistent with the KV TOCTOU pattern (P2-5, P3-31).
- **Session-not-invalidated-on-reset** (P1-3) and **unbounded-password DoS** (P1-4) were each found
  independently by the auth and accounts agents.
- **PI amount not cross-checked / non-constant-time HMAC** (P1-7) was raised by both the Stripe and
  pricing agents.
- **Slot capacity** is both a dead feature (Pricing) and a TOCTOU race (Accounts) — fix together.
- The pricing and data agents **both independently confirmed** the shop menu data (IDs + prices) is
  consistent — the long-standing "ID drift" gotcha is currently clean.
