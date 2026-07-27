# Rico's / Food Station — Project Guide

**Read this first, every session.** This file is the source of truth for how
the project is set up. Don't invent a different structure — if something here
seems wrong, ask before changing the architecture.

This repo (`Josh-hype/Ricos`) is **one multi-tenant codebase** that powers
**multiple restaurant websites** from a single source. Today it runs two live
shops, with a third scaffolded (pre-launch):

- **Rico's Peri Peri** — York (slug `ricos`) — live
- **Food Station** — Easingwold (slug `food-station`) — live
- **The Grub Hub** — York (slug `grub-hub`) — pre-launch: collection-only, and
  its `stripe.connectedAccountId` + `business` legal fields are still
  placeholders (the build warns loudly; card payments are off until they're set).

More shops are added the same way (see "Adding a new shop").

---

## The three golden rules

1. **Shops are folders, not branches.** Every shop lives under
   `data/shops/<slug>/` and is selected at build time by the `SHOP_SLUG`
   environment variable. There is no "ricos branch" or "food-station branch".
2. **Build outputs are never committed.** `public/` (the built site) and
   `data/_active/` are generated on every deploy by `npm run build`. They are
   gitignored. A committed copy goes stale and gets served by mistake — that
   already bit us once (Rico's menu options "vanished" because a stale
   committed `public/` was being served).
3. **Never fork shared code for one shop.** If one shop needs different
   behaviour, gate it behind a config flag so it ships to everyone but only
   renders where it's turned on. One codebase, forever.

---

## Branches & workflow

- **`main`** — production. Both live sites build from it. Only merge tested code.
- **`dev`** — staging / playground. Push experiments here; Cloudflare builds it
  as a **preview** (separate URL) so the live sites are untouched.
- These are the **only** two branches. (All the old `claude/*` branches were
  consolidated into `main` and deleted.)

**Workflow:** work on `dev` → check the Cloudflare preview URL → merge to
`main` when happy → both live sites rebuild automatically.

---

## Repository layout

| Path | What it is |
|------|-----------|
| `data/shops/<slug>/` | **Per-shop source** (one folder per shop). See below. |
| `data/shops/_template/` | Scaffold for new shops (build refuses `_`-prefixed slugs). |
| `data/_active/` | **Generated.** The active shop's `config.json` + `menu.json`, written by the build; imported by the API. Gitignored. |
| `templates/` | **Shared** HTML/manifest templates with `{{token}}` placeholders. |
| `functions/` | **Shared** Cloudflare Pages Functions (the backend API). |
| `scripts/build-shop.js` | The build: resolves `SHOP_SLUG`, copies the shop's files, substitutes tokens, validates menu invariants. |
| `public/` | **Generated** site output (gitignored) — *except* the three static files below. |
| `templates/admin/` | **Shared** UI for the Lumin Labs owner console (a separate Pages project, built with `PLATFORM_BUILD=1`, not a `SHOP_SLUG`). |
| `data/platform/registry.json` | Platform-level shop registry (revenue reporting / owner console). |
| `app/` | The LumiPOS native till (Capacitor/Android wrapper around `templates/staff/`). Ships to real Sunmi tills **over the air** — see the OTA note below. |
| `test/`, `tests/` | Unit tests (`test/auth.test.mjs`; `tests/` covers the money/logic libs — run `node --import ./tests/support/register.mjs --test tests/*.test.mjs`). |
| `docs/` | `ADDING_A_SHOP.md`, `SHOP_CHECKLIST.md`, etc. |

**Static files in `public/` that ARE committed** (served as-is, not generated):
just `_headers`, `_redirects`, `robots.txt`. Everything else under `public/` —
including `privacy.html`, `terms.html`, `allergy-info.html`, `sitemap.xml`, and
the `*.inline*.js` files — is **generated** by the build and gitignored.

**Note — pushing to `main` also updates the physical tills.** A push to `main`
that touches `templates/staff/**`, `app/web/**`, `app/scripts/sync-web.mjs`, or
`scripts/build-shop.js` triggers `.github/workflows/ota-publish.yml`, which
publishes a new LumiPOS bundle to Capgo's `production` channel; every live Sunmi
till auto-updates on its next launch. Treat staff-UI pushes as fleet deploys.

---

## How the build works

- Command: `npm run build` (= `node scripts/build-shop.js`). Pure Node
  built-ins, no `npm install` needed to run it locally. `package.json` also has
  a `postinstall` that runs it.
- It reads `SHOP_SLUG` (defaults to `ricos` for local dev only) and for that shop:
  - `data/shops/<slug>/config.json` → `data/_active/config.json`
  - `data/shops/<slug>/menu.json` → `data/_active/menu.json`
  - `data/shops/<slug>/menu-visual.json` → `public/menu-visual.json`
  - `data/shops/<slug>/logo.png` → `public/logo.png`
  - `data/shops/<slug>/assets/*` → `public/assets/*` (optional)
  - substitutes `{{tokens}}` from config into the templates → `public/`
- It ends with `build-shop: active shop is "<slug>"`. **Always check that line**
  — if it shows the wrong slug, `SHOP_SLUG` is wrong.
- **Generated files (gitignored, rebuilt every deploy):** `public/index.html`,
  `public/logo.png`, `public/menu-visual.json`, `public/order.html`,
  `public/thank-you.html`, `public/reset-password.html`, `public/privacy.html`,
  `public/terms.html`, `public/allergy-info.html`, `public/sitemap.xml`,
  `public/staff/index.html`, `public/staff/manifest.json`, `public/assets/`,
  every `public/**/*.inline*.js`, `public/reader-bg.*`, and `data/_active/`.

---

## Shared code vs per-shop data (know your blast radius)

**Shared** — a change here affects **every** shop, so test more than one:
- `templates/order.html`, `templates/staff/`, `templates/landing-default.html`,
  `templates/thank-you.html`, `templates/reset-password.html`
- `scripts/build-shop.js`
- `functions/` (orders, Stripe, staff; `functions/_lib/totals.js` is the
  authority on pricing)

**Per-shop** — a change here affects only that one shop, under
`data/shops/<slug>/`:
- `config.json` — business info, theme colours + fonts, opening hours,
  delivery, `stripe.connectedAccountId` **(required)**. Delivery has two modes
  via `fulfillment.delivery.mode`: **`outcode`** (charge by postcode area) or
  **`radius`** (charge by straight-line distance bands from the shop, geocoded
  free via postcodes.io). Default is `outcode` — but **both live shops (Rico's
  and Food Station) now use `radius`**. (Grub Hub has delivery disabled.)
- `menu.json` — server source of truth, prices in **pence** **(required)**
- `menu-visual.json` — customer-facing menu (names, photos, options) **(required)**
- `logo.png` — the logo **(required — build fails without it)**
- `index.html` *(optional)* — bespoke landing; omit to use `landing-default.html`
- `assets/` *(optional)* — photos copied to `public/assets/`
- `order.css` *(optional)* — per-shop CSS appended to the order page

### Till service style (takeaway vs hospitality)

`config.json` → `pos.serviceStyle` decides which sale modes the till offers:

| Value | Sale modes on the till |
|-------|------------------------|
| `takeaway` *(default — omit the key)* | Walk in · Collection · Delivery |
| `hospitality` | Eat in · Takeaway |

`hospitality` is for coffee shops and restaurants (One Sip is the first).
**Eat in** shows a tappable table grid built from `pos.tables`; the chosen table
is stored on the order (`order.table`), printed on the kitchen ticket and the
receipt, and shown on the board. `pos.tables` takes either plain labels or
objects with an `area` to group the grid:

```json
"pos": {
  "serviceStyle": "hospitality",
  "tables": [
    { "label": "1", "area": "Inside" },
    { "label": "7", "area": "Window" }
  ]
}
```

The server validates the table against this list, so an unknown table can never
reach an order. `pos.modes` (optional) overrides the derived set outright — use
it for a restaurant that also wants Collection/Delivery alongside Eat in.
Takeaway shops that don't set `serviceStyle` are completely unaffected.

Tables are **tag-and-charge-now** today (the table is recorded, payment is taken
at the counter). Open tabs / pay-at-the-end is deliberately *not* built yet.

---

## Menu / item-options schema (dual file, linked by `id`)

- **`menu-visual.json`** = client display. Item options live under `options`:
  `[{id, label, select: "single"|"multi", required, choices: [{id, label, price}]}]`
  — `price` is in **pounds** (display only).
- **`menu.json`** = server truth. The same item carries `modifiers`:
  `[{id, label, priceDeltaP}]` — `priceDeltaP` is in **pence**.
- The choice `id` links the two. `functions/_lib/totals.js` sums modifier
  prices server-side — it decides what the customer is actually charged.
- Item IDs in `menu.json` and `menu-visual.json` **must match exactly**.

---

## Cloudflare deployment (one Pages project per site, same repo)

Each project (`ricos`, the Food Station project, and any future shop):

- **Build command:** `npm run build` — **required.** Build outputs aren't
  committed, so a project that doesn't build ships an empty/broken site. Do
  **not** leave it blank.
- **Build output directory:** `public`
- **Production branch:** `main`
- **Environment variables — set for BOTH Production and Preview:**
  - `SHOP_SLUG` = the shop's slug (`ricos`, `food-station`, …)
  - `NODE_VERSION` = `20`
  - Skip the dependency install (the build is pure Node built-ins — Cloudflare
    needs nothing from npm, not even wrangler). Which variable depends on the
    project's build system: **new projects (v2 build system — the log says
    "Using v2 root directory strategy") use `SKIP_DEPENDENCY_INSTALL` = `1`**;
    the older v1 projects (ricos, food-station, mega-chippy) keep
    `NPM_FLAGS` = `--omit=dev` (v2 silently ignores NPM_FLAGS — discovered on
    the one-sip project, 2026-07-18).
- **Build watch paths** (Settings → Builds & deployments): Include `*`, Exclude
  every OTHER shop's folder (`data/shops/<other-slug>/*`, one per shop). Without
  this, a one-shop change rebuilds **every** project. Each project excludes every
  shop except its own; shared-code changes still rebuild all. **Adding a new shop?
  Add its `data/shops/<slug>/*` to every existing project's Exclude paths too.**
- **KV namespaces** (create per shop, bind by these names):
  `ORDERS_KV`, `CUSTOMERS_KV`, `MARKETING_KV`, `SLOTS_KV`, `STAFF_LOGIN_KV`
- **Secrets** (encrypted env vars — names the code actually reads):
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Email (Resend): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
  - SMS (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
  - Sessions/staff: `SESSION_SECRET`, `STAFF_PIN_HASH` (staff log in with a
    PIN; store its hash, never the raw PIN). Optional: `MANAGER_PIN_HASH` (a
    second PIN gating the financial views — Today/Z-report — and manager
    overrides; **unset ⇒ any staff PIN can see the figures and no override gate**,
    so set it per shop). Optional web back-office login: `STAFF_USERNAME` +
    `STAFF_PASSWORD_HASH` (a stronger username/password than the numeric PIN;
    dormant until both are set).
  - Address finder (optional): `IDEALPOSTCODES_API_KEY` (or legacy alias
    `ADDRESS_LOOKUP_API_KEY`) lights up the address lookup; bind one shared
    `ADDRESS_KV` namespace across shops to cache paid lookups platform-wide.
  - Till app setup: `TILL_SETUP_PASSWORD` (optional, per shop — the password a device
    enters alongside its 6-digit Restaurant ID to provision the LumiPOS app to this
    shop, verified by `/api/staff/device-setup`; unset ⇒ the app's "site address"
    fallback is used instead. Make it different per shop.)
- **Custom domain:** add it under the project's Custom domains.

A push to `main` rebuilds each project (each with its own `SHOP_SLUG`) — but with
the **Build watch paths** above, a change to a single shop's `data/shops/<slug>/`
only rebuilds that shop, while shared-code changes still rebuild all.
Stripe is **Stripe Connect** in **LIVE** mode. The platform's API keys
(`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`) are **shared across all shops** —
each shop's project sets the same platform keys; what differs per shop is the
`connectedAccountId` (the venue's `acct_…`) and that shop's own Connect webhook
endpoint + `STRIPE_WEBHOOK_SECRET`. Because the secret key is shared, **never
roll it with immediate expiry** — that breaks every live shop at once; roll with
a grace window and update every project before it lapses. Cloudflare keeps every
past deployment — one-click **Rollback** if a deploy breaks a site.

---

## Adding a new shop (3rd, 4th, 5th…)

Follow the runbooks — **do not invent a new process:**
- **`docs/ADDING_A_SHOP.md`** — full walkthrough
- **`docs/SHOP_CHECKLIST.md`** — tick-box version

Brief shape:
1. `cp -r data/shops/_template data/shops/<slug>` (slug = lowercase, dashes).
2. Fill in `config.json`, `menu.json` (pence), `menu-visual.json`; add
   `logo.png`. (Optional: `index.html`, `assets/`, `order.css`.)
3. `SHOP_SLUG=<slug> npm run build` — must end with `active shop is "<slug>"`.
4. Commit on `dev`, check the preview, merge to `main`.
5. Create a new Cloudflare Pages project (settings exactly as the Cloudflare
   section above): `npm run build`, branch `main`, `SHOP_SLUG` (Prod+Preview),
   5 KV namespaces, secrets, custom domain.

---

## Gotchas we've already hit (don't repeat them)

- **Stale committed build →** the original cause of "Rico's menu disappeared".
  Fixed by gitignoring build outputs + setting every project's build command to
  `npm run build`. Never re-commit `public/`/`data/_active/`.
- **`SHOP_SLUG` only on Production →** previews build the wrong shop. Set it on
  **Preview** too.
- **Blank build command →** now ships an empty site (outputs aren't committed).
  Always `npm run build`.
- **Item IDs drifting between `menu.json` and `menu-visual.json` →** prices/
  options render wrong. Keep IDs identical.

---

## Starting a session

The user will say which brand we're working on (Rico's, Food Station, or the
Grub Hub). That tells you which `data/shops/<slug>/` folder to edit and which
`SHOP_SLUG` / Cloudflare project it maps to — but **all shops share the one
`main` codebase**, so before assuming a change is isolated, check whether you're
touching per-shop data or shared code. Remember shared changes under
`templates/staff/**` or `app/web/**` also OTA-deploy to the live tills.
