# Rico's / Food Station — Project Guide

This repo (`Josh-hype/Ricos`) is **one multi-tenant codebase** that powers
**multiple restaurant websites** from a single source. We currently run two
sites and can add more the same way:

- **Rico's Peri Peri** — York
- **Food Station** — Easingwold

## #1 rule — shops are NOT separate branches

There is **one** production code branch: `main`. **Both sites build from it.**

A "shop" is a tenant **folder** under `data/shops/<slug>/`, selected at build
time by the `SHOP_SLUG` environment variable — it is **not** a git branch.

| Shop | Folder | `SHOP_SLUG` |
|------|--------|-------------|
| Rico's | `data/shops/ricos/` | `ricos` |
| Food Station | `data/shops/food-station/` | `food-station` |

Do **not** create a branch per shop, and do **not** look for a "ricos branch"
or "food station branch" — that old layout was retired and consolidated into
`main`.

## Branches

- **`main`** — production. Both live sites deploy from it. Only merge **tested** code.
- **`dev`** — staging / playground. Push experiments here; Cloudflare builds it
  as a **preview** (separate URL) so the live sites are never affected.
- Any leftover `claude/*` branches are deprecated — ignore them.

**Workflow:** work on `dev` (or a feature branch) → check the Cloudflare
preview URL → merge into `main` when happy → both live sites rebuild.

## How a build works

- Build command: `npm run build` (= `node scripts/build-shop.js`). Uses only
  Node built-ins — no `npm install` needed.
- It reads `SHOP_SLUG` (default `ricos`) and for that shop:
  - `data/shops/<slug>/config.json` → `data/_active/config.json`
  - `data/shops/<slug>/menu.json` → `data/_active/menu.json`
  - `data/shops/<slug>/menu-visual.json` → `public/menu-visual.json`
  - then substitutes `{{tokens}}` from config into the templates → `public/`.
- The API (`functions/_lib/`) imports `data/_active/*`, so each deploy bundles
  the active shop's data.
- `public/` and `data/_active/` are **build output** (regenerated every
  deploy) — don't hand-edit them.

## Shared code vs per-shop data (know your blast radius)

**Shared** — a change here affects **every** shop, so test both:
- `templates/order.html`, `templates/staff/`
- `scripts/build-shop.js`
- `functions/` (API: orders, Stripe, staff; `functions/_lib/totals.js`, etc.)

**Per-shop** — a change here affects only that one shop:
- `data/shops/<slug>/` → `config.json` (business info, theme, fonts,
  fulfilment, Stripe), `menu.json`, `menu-visual.json`, `index.html` (landing),
  `logo.png`, `assets/`, `order.css` (optional per-shop CSS overrides)

## Menu / item-options schema (dual file, linked by `id`)

- **`menu-visual.json`** = client display. Item options live under `options`:
  `[{id, label, select: "single"|"multi", required, choices: [{id, label, price}]}]`
  — `price` is in **pounds** (display only).
- **`menu.json`** = server truth. The same item carries `modifiers`:
  `[{id, label, priceDeltaP}]` — `priceDeltaP` is in **pence**.
- The choice `id` links the two. `functions/_lib/totals.js` sums modifier
  prices server-side and is the authority on what the customer is charged.

## Deployment (Cloudflare Pages — one project per site)

Each project is configured with:
- **Build command:** `npm run build`
- **`SHOP_SLUG`** set for **both** the Production and Preview environments
  (`ricos` for the Rico's project, `food-station` for the Food Station project)
- **Production branch:** `main`

Push to `main` → both sites rebuild automatically.

- Stripe is **Stripe Connect**, currently **TEST** mode (per-shop
  `connectedAccountId` in that shop's `config.json`).
- Safety net: Cloudflare keeps every past deployment — one-click **Rollback**
  if a deploy breaks a site.

## Adding a new shop (3rd, 4th, 5th…)

Follow the existing runbooks — **do not invent a new process**:
- **`docs/ADDING_A_SHOP.md`** — full end-to-end walkthrough
- **`docs/SHOP_CHECKLIST.md`** — the tick-box version of the same

The shape, in brief:
1. `cp -r data/shops/_template data/shops/<slug>` (slug = lowercase, dashes only).
2. Fill in `config.json`, `menu.json` (prices in **pence**), `menu-visual.json`.
   **Required files** (build fails without them): `config.json`, `menu.json`,
   `menu-visual.json`, **`logo.png`**. Optional: `index.html` (otherwise the
   shared `templates/landing-default.html` is used), `assets/` (photos),
   `order.css` (per-shop CSS).
3. Test locally: `SHOP_SLUG=<slug> npm run build` — must end with
   `active shop is "<slug>"`.
4. Commit on `dev`, check the preview, merge to `main`.
5. Create a **new Cloudflare Pages project** on the **same** repo: build command
   `npm run build`, production branch `main`, env `SHOP_SLUG=<slug>` (+
   `NODE_VERSION`) for **both** Production and Preview; create its 5 KV
   namespaces and bind them (`ORDERS_KV`, `CUSTOMERS_KV`, `MARKETING_KV`,
   `SLOTS_KV`, `STAFF_LOGIN_KV`); add the secrets (`STRIPE_*`, `RESEND_*`,
   `TWILIO_*`, `SESSION_SECRET`, `STAFF_PIN_HASH`); add the custom domain.
   All of this is detailed step-by-step in the docs above.

**Never fork shared code for one shop** — gate shop-specific behaviour behind a
config flag so it ships to everyone but only renders where it's turned on.

## Starting a session

The user will say which brand we're working on (Rico's or Food Station). That
tells you which `data/shops/<slug>/` folder to edit and which `SHOP_SLUG` /
Cloudflare project it maps to — but remember **both shops share the one `main`
codebase**, so check whether your change is per-shop data or shared code before
assuming it's isolated.
