# Adding a new shop

This codebase is multi-tenant: one repo, one set of code, deployed
separately for each shop via Cloudflare Pages. Each shop is identified
by a `SHOP_SLUG` (lowercase, dashes only) and lives entirely under
`data/shops/<slug>/`.

This document is the step-by-step checklist for onboarding a new shop
end-to-end, from gathering info to going live.

## 0. First — which product are they buying?

Steps 1–5 are **identical for both products**; only step 6 (the device) and
what you bill them differ. See `docs/PRODUCTS.md`.

| | **LumiPOS** (~£35/wk) | **LumiWEB** (£19/wk) |
|---|---|---|
| They get | The full till — counter sales, cash drawer, Z report | The website + web back office only |
| Hardware | **Sunmi T2** (big dual-screen all-in-one) | **ZCS Z93** (small unit, built-in 80mm printer, no drawer) |

Nothing in the codebase branches on this — same folder, same build, same
Cloudflare project either way.

---

## 1. Collect this info from the shop owner

Send them a form (Google Forms / Notion doc) covering everything below.
~15 minutes for them to fill in.

### Business

- Trading name (the customer-facing brand, e.g. "Pizza Bob's")
- Short conversational form (e.g. "Pizza Bob's" instead of the legal name)
- Legal company name + Companies House number
- Address: line 1, city, postcode, country
- Phone number (national format, e.g. 0113 245 6789)
- Orders email (e.g. orders@pizzabob.co.uk)
- Domain they own (e.g. pizzabob.co.uk)

### Branding

- **Logo PNG** — ideally square, transparent background, at least 512×512
- **Brand colours** — primary (the dominant brand colour) and accent
  (the secondary highlight). Hex codes preferred.
- Anything else they want emphasised (one-line tagline, hero photo, etc.)

### Operations

- Opening hours per day (e.g. Mon-Sat 12:00-22:00, Sun closed)
- Collection: enabled? Delivery: enabled? Both?
- **Delivery pricing model** — pick one (`fulfillment.delivery.mode` in config):
  - **`outcode`** — charge by postcode area. Collect: the outcodes covered
    (e.g. LS1, LS2, LS6) and the fee per outcode. (Rico's uses this.)
  - **`radius`** — charge by straight-line distance from the shop, in bands
    (e.g. 0–1mi £1, 1–2mi £2 … up to a max radius). Collect: the band
    distances + fees and the max delivery distance. Distances use postcodes.io
    (free, no key); origin is the shop's own postcode. (Food Station uses this.)
- If delivery: minimum order in pence (e.g. 1500 = £15)
- Friendly description of the delivery zone (used in messages, e.g. "within
  3 miles of the shop")

### Menu

- Full menu with prices in pence
- Photos of items (will be base64-embedded in menu-visual.json for now)
- Per-item: description, whether meal upgrade is available (and the
  upgrade price)
- Categories (Mains, Sides, Drinks, etc.) with an emoji icon each

### Payments

- They sign up for Stripe Connect via your platform's onboarding link.
  This produces an `acct_xxx` Stripe Connect ID.

---

## 2. Add the shop's data folder

```bash
cp -r data/shops/_template data/shops/<your-slug>
```

Then edit each file:

- `data/shops/<slug>/config.json` — fill in business, theme, hours,
  delivery zone, Stripe Connect ID, etc.
- `data/shops/<slug>/menu.json` — the canonical menu (server-side
  source of truth for prices). Items have `id`, `name`, `priceP`,
  optional `mealAddP`.
- `data/shops/<slug>/menu-visual.json` — same item IDs, plus
  customer-facing details (`name`, `price` as pounds float, `desc`,
  `spicy`, `meal: { label, addPrice, image }`). The category icons +
  any photos live here.
- `data/shops/<slug>/logo.png` — the shop's logo.
- `data/shops/<slug>/index.html` *(optional)* — if you want a bespoke
  landing page, drop it here. Tokens like `{{shopName}}` are substituted.
  Omit the file to use `templates/landing-default.html` instead.

Test the build locally:

```bash
SHOP_SLUG=<your-slug> npm run build
```

You should see no errors and `public/` should now contain that shop's
substituted output. Open `public/order.html` in a browser to sanity check.

Commit and push.

---

## 3. Set up the Cloudflare Pages project

The shop gets its own Pages project, sharing the same GitHub repo as the
others. In the Cloudflare dashboard:

### a) Create the project

- **Workers & Pages → Create → Pages → Connect to Git**
- Repo: `josh-hype/ricos`
- Production branch: `main` (or whichever branch you deploy from)
- **Project name**: `<your-slug>` — this becomes part of the default
  `*.pages.dev` URL

### b) Build settings

- **Framework preset**: None
- **Build command**: `npm run build` — **required.** Build outputs are not
  committed to the repo, so a project that doesn't build ships an empty site.
  Never leave it blank.
- **Build output directory**: `public`
- **Environment variables (Production + Preview)**:
  - `SHOP_SLUG` = `<your-slug>`
  - `NODE_VERSION` = `20` (or whatever matches local dev)
  - `SKIP_DEPENDENCY_INSTALL` = `1` — skips `npm install` entirely. The build
    is pure Node built-ins, so Cloudflare needs nothing from npm (not even
    wrangler — Functions upload uses Cloudflare's own toolchain) and builds
    get much faster. **Set it on Production AND Preview.**
    (New projects run the v2 build system, which silently ignores the old
    `NPM_FLAGS` = `--omit=dev` — that variable only still works on the v1-era
    projects: ricos, food-station, mega-chippy.)

### b2) Build watch paths — only rebuild the shop that changed

**Every shop is a separate Pages project, and they all watch the same repo +
`main` branch — so by default a change to ONE shop's folder rebuilds EVERY
project** (slow, and an unnecessary deploy to unrelated live shops). Fix it per
project under **Settings → Builds & deployments → Build watch paths**:

- **Include paths**: `*` (everything — so shared-code changes still rebuild
  this shop, which is correct).
- **Exclude paths**: every OTHER shop's folder, e.g. for the `mega-chippy`
  project: `data/shops/ricos/*`, `data/shops/food-station/*`,
  `data/shops/grub-hub/*`. (One tag each; no separators.)

The rule: **each project excludes every shop folder except its own.** A change
to `data/shops/<this-shop>/**` or to shared code (`templates/`, `functions/`,
`scripts/`) still builds; a change to only another shop's folder is skipped.

⚠️ **When you add a NEW shop, update the EXISTING projects too:** add the new
shop's `data/shops/<new-slug>/*` to every other project's Exclude paths, or
they'll keep rebuilding whenever the new shop changes.

### c) KV namespaces

Each shop has its own data storage — no sharing across shops. In
**Workers & Pages → KV**, create 5 namespaces (suggest naming pattern
`<slug>-ORDERS_KV`, `<slug>-CUSTOMERS_KV`, etc.):

- `ORDERS_KV`
- `CUSTOMERS_KV`
- `MARKETING_KV`
- `SLOTS_KV`
- `STAFF_LOGIN_KV`

Then bind them: **Pages project → Settings → Functions → KV namespace
bindings**. The binding name is the env-var key Functions read
(`ORDERS_KV` etc.); the value is the namespace ID you just created.

### d) Secrets

**Pages project → Settings → Environment variables → Production**. Add as
encrypted/secret variables (not plaintext):

- `STRIPE_SECRET_KEY` — the platform Stripe key (same across all shops,
  Connect routes payment to each shop's connected account)
- `STRIPE_PUBLISHABLE_KEY` — same
- `STRIPE_WEBHOOK_SECRET` — same
- `RESEND_API_KEY` — **one key per shop**, not a shared one. In Resend →
  API keys → Create, name it after the slug, permission **Sending access**
  (never Full access — the site only ever sends), and scope it to the shop's
  own domain. A per-shop key means a leak is revoked without taking every
  other site's email down with it. Resend shows the key once; copy it straight
  into Cloudflare as a **Secret**, never plaintext.
- `RESEND_FROM_EMAIL` — e.g. `orders@<shop-domain>`
- `RESEND_FROM_NAME` — e.g. shop's trading name
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — genuinely shared: one Twilio
  account serves the platform, so these are identical on every shop. The SID
  starts `AC`; an `SK…` API key 401s and never reaches Twilio's message log.
- `TWILIO_FROM_NUMBER` — **per shop.** Buy this shop an SMS-capable UK `+447…`
  in E.164. Our texts carry links, which UK carriers filter aggressively when
  the sender doesn't match the brand, and a per-shop number keeps one shop's
  deliverability problems off the others. All three are optional — unset means
  `sendSms` skips, which costs pay-by-link and phone-only password resets but
  nothing in the ordering flow.
- `SESSION_SECRET` — a long random string; signs staff login sessions
- `STAFF_PIN_HASH` — hash of the staff login PIN. Staff enter the PIN at
  `/staff`; store its hash here, never the raw PIN.

### e) Custom domain

**Pages project → Custom domains → Set up a custom domain → Enter
`<shop-domain>`**. Cloudflare prints DNS records to add. Either:

- The shop's DNS is on Cloudflare → records are added automatically
- The shop's DNS is elsewhere → give them the records to add

SSL provisions automatically in ~5 minutes once DNS resolves.

### f) Trigger a deploy

Push any small commit to the repo (or hit **Create deployment** in the
Pages dashboard). Watch the build log: you should see the
`build-shop: ... active shop is "<your-slug>"` line near the end. If
you see `active shop is "ricos"`, the `SHOP_SLUG` env var isn't set —
go back to step (b).

---

## 4. Stripe Connect onboarding

Send the shop owner your Stripe Connect onboarding link (set this up
once in your Stripe dashboard). They:

1. Enter business name, address, bank account, ID document.
2. Stripe creates their connected account, returns an `acct_xxx` ID.
3. You add that ID to `data/shops/<slug>/config.json` under
   `stripe.connectedAccountId` and push.

From that point card payments flow to the shop's bank, the
`serviceFeePence` per-order fee flows to your platform account.

---

## 5. Verify before going live

Walk through end-to-end on the new domain:

- [ ] `<shop-domain>/` loads — landing page shows their logo, name,
      colours
- [ ] `<shop-domain>/order` loads, menu appears (may show "Loading
      menu…" for a beat on first load), correct items + prices, photos
- [ ] Postcode validation: in-zone postcode accepted, out-of-zone gives
      the right error message mentioning the shop's area description
- [ ] Place a real order with a real card — confirm receipt email
      arrives in the shop's brand colours with their logo
- [ ] `<shop-domain>/staff` — log in with the staff PIN, the test
      order is visible, sound notification fires
- [ ] Cancel/refund the test order in Stripe so the customer (you)
      gets refunded

Once green, give the shop their staff password and a setup guide for
their kitchen screen (any web browser at `<shop-domain>/staff` works —
Smart TV, tablet, laptop with HDMI to a monitor, etc.).

---

## 6. Provision their device (LumiPOS T2 **or** LumiWEB Z93)

Both devices run the **same APK** and provision the same way — see
`docs/PRODUCTS.md`.

1. **Pick a 6-digit Restaurant ID** and add it to the `DIRECTORY` in
   **`app/web/provision.js`**, pointing at the shop's **reachable custom
   domain**:
   ```js
   '<6 digits>': 'https://<shop-domain>',
   ```
   ⚠️ Never a `*.pages.dev` host — they're firewalled on this Cloudflare
   setup and return 403 ("Host not in allowlist"). ⚠️ This is **shared code**
   under `app/web/`, so pushing it to `main` also triggers an **OTA publish to
   every live device**. That's fine (the directory is additive), but it is a
   fleet deploy — don't bundle it with anything untested.
2. Set **`TILL_SETUP_PASSWORD`** in the shop's Cloudflare project (see the
   secrets list above). Without it the ID route is disabled and only the
   "use a site address instead" fallback works.
3. On the device: open **LumiPOS → "Set up this till"** → enter the Restaurant
   ID + that password. Re-provision by clearing app storage.
4. Log in with the staff PIN and **print a test ticket** — that's the only way
   to confirm the printer backend bound (Sunmi on a T2, ZCS on a Z93).

---

## Ongoing

- **Updating Rico's or other shops**: any code change pushed to the
  repo redeploys every Pages project (each rebuilds with its own
  SHOP_SLUG). Fixes ship to all shops at once. Test on Rico's first.
- **Menu / price / hours changes**: edit the shop's
  `data/shops/<slug>/config.json` or `menu.json`, push. Their deploy
  rebuilds; others are unaffected.
- **Adding a feature for one shop only**: gate it behind a config flag
  (e.g. `features.loyaltyPoints: true`) so the feature ships to
  everyone but only renders when the shop turns it on. NEVER fork the
  code — feature flags only.
