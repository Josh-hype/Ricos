# New shop onboarding checklist

Action-focused checklist for spinning up a new shop on the platform.
Total time: ~60 min of your active work + ~20 min from the shop owner.

For deeper detail on any step see [`ADDING_A_SHOP.md`](ADDING_A_SHOP.md).
For the info you need to collect from the restaurant before any of this
makes sense, send them [`SHOP_INTAKE_FORM.md`](SHOP_INTAKE_FORM.md).

---

## Before you start — you need access to

- [ ] GitHub repo (`josh-hype/ricos`) — push access
- [ ] Cloudflare dashboard
- [ ] Your Stripe dashboard (Connect platform account)
- [ ] Your Resend dashboard
- [ ] Your Twilio dashboard

## Phase 1 — Gather info from the shop owner (~15 min, them)

- [ ] Send them the [`SHOP_INTAKE_FORM.md`](SHOP_INTAKE_FORM.md) (or paste it
      into a Google Form / Notion doc) and wait for the filled-in version
      plus their logo, photos, and Stripe Connect onboarding completion.

## Phase 2 — Code (~10 min, you)

Pick a slug — lowercase, dashes only, no leading underscore (e.g. `bobs-burgers`).

- [ ] `cp -r data/shops/_template data/shops/<slug>`
- [ ] Edit `data/shops/<slug>/config.json` — fill in business, theme,
      hours, delivery zone, Stripe `acct_xxx`
- [ ] Edit `data/shops/<slug>/menu.json` — items with `priceP` in pence
- [ ] Edit `data/shops/<slug>/menu-visual.json` — same item IDs, plus
      descriptions and photos. **Item IDs must match `menu.json` exactly.**
- [ ] Drop the shop's `logo.png` into the folder
- [ ] (Optional) drop a custom `index.html` for a bespoke landing page;
      otherwise the generic template at `templates/landing-default.html`
      is used
- [ ] Test locally: `SHOP_SLUG=<slug> npm run build` — should end with
      `active shop is "<slug>"` and no errors
- [ ] Commit + push

## Phase 3 — Cloudflare Pages project (~15 min, you)

- [ ] **Workers & Pages → Create → Pages → Connect to Git** → pick
      `josh-hype/ricos`
- [ ] **Project name**: `<slug>` (becomes the `*.pages.dev` URL)
- [ ] **Production branch**: `main`
- [ ] **Build settings**:
  - [ ] Framework preset: None
  - [ ] Build command: `npm run build` (required — outputs aren't committed)
  - [ ] Build output directory: `public`
- [ ] **Environment variables (Production + Preview)**:
  - [ ] `SHOP_SLUG` = `<slug>`
  - [ ] `NODE_VERSION` = `20`
  - [ ] `SKIP_DEPENDENCY_INSTALL` = `1` (skips npm install entirely → faster
        builds; the v2 build system ignores the old `NPM_FLAGS` var)
- [ ] **Build watch paths** (Settings → Builds & deployments): Include `*`;
      Exclude every OTHER shop's folder — e.g. `data/shops/<other-slug>/*` per
      existing shop. So a one-shop change only rebuilds that shop.
- [ ] ⚠️ **Update the EXISTING projects:** add this new shop's
      `data/shops/<slug>/*` to every other project's Exclude paths (or they'll
      rebuild whenever this shop changes).

## Phase 4 — KV namespaces (~5 min, you)

In **Workers & Pages → KV**, create 5 namespaces (suggest naming
pattern `<slug>-ORDERS_KV` etc.):

- [ ] `ORDERS_KV`
- [ ] `CUSTOMERS_KV`
- [ ] `MARKETING_KV`
- [ ] `SLOTS_KV`
- [ ] `STAFF_LOGIN_KV`

Then bind them: **Pages project → Settings → Functions → KV namespace
bindings**. The binding name on the left is the variable the code reads
(`ORDERS_KV`); the value is the namespace ID you just created.

## Phase 5 — Secrets (~5 min, you)

**Pages project → Settings → Environment variables → Production**.
Add each as **encrypted** (the lock icon), not plaintext:

- [ ] `STRIPE_SECRET_KEY` (your platform key — same across shops)
- [ ] `STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `RESEND_API_KEY` (shared)
- [ ] `RESEND_FROM_EMAIL` = `orders@<shop-domain>`
- [ ] `RESEND_FROM_NAME` = shop's trading name
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
      (shared)
- [ ] `SESSION_SECRET` — long random string; signs staff login sessions
- [ ] `STAFF_PIN_HASH` — hash of the staff login PIN (staff enter the PIN
      at `/staff`; store its hash, not the raw PIN)
- [ ] `MANAGER_PIN_HASH` — hash of a **separate** manager PIN that gates the
      financial views (Today's takings / Z-report) and refund/void overrides.
      **Leave this unset and any staff PIN can see the figures with no override
      gate** — set it for every shop. Hash it the same way as `STAFF_PIN_HASH`.
- [ ] `TILL_SETUP_PASSWORD` — per-shop password a LumiPOS till enters (with its
      6-digit Restaurant ID) to provision to this shop via `/api/staff/device-setup`.
      Unset ⇒ the ID-based setup is disabled and only the "site address" fallback
      works. Make it different per shop.
- [ ] *(optional)* `STAFF_USERNAME` + `STAFF_PASSWORD_HASH` — a stronger
      username/password login for the web back office (dormant until both set).

## Phase 6 — Custom domain (~5 min, you + DNS propagation)

- [ ] **Pages project → Custom domains → Set up a custom domain →
      `<shop-domain>`**
- [ ] If their DNS is on Cloudflare: records added automatically
- [ ] If elsewhere: copy the DNS records Cloudflare shows and send them
      to the shop owner (or paste into their DNS provider directly if
      they gave you access)
- [ ] Wait for DNS to resolve + SSL to provision (usually <10 min, can
      take longer)

## Phase 7 — First deploy + sanity check

- [ ] Push any small commit (or hit **Create deployment** in the Pages
      dashboard)
- [ ] Watch the build log: should end with
      `build-shop: active shop is "<slug>"` — if it says `"ricos"`, the
      `SHOP_SLUG` env var isn't set; fix that
- [ ] Open the new domain — landing page loads with the shop's logo and
      brand colours
- [ ] Open `/order` — menu items + correct prices appear

## Phase 8 — Pre-launch testing (~10 min)

Walk through on the live URL with a real card (you'll refund after):

- [ ] **Postcode validation**: in-zone postcode is accepted; out-of-zone
      shows the right error mentioning their service area
- [ ] **Place a real order with a real card** — go all the way through
      payment, confirm `/thank-you` loads
- [ ] **Receipt email arrives** in the shop's brand colours with logo,
      address, phone
- [ ] **Staff page** (`<shop-domain>/staff`) — log in with the staff
      PIN, the test order appears, sound notification fires
- [ ] **Refund the test order in Stripe** so you get the money back
- [ ] **Test signed-in flow**: create a customer account, place a small
      order with "Save card" ticked, sign back in on a fresh browser,
      confirm the saved card appears as a tile

## Phase 9 — Hand off to the shop

- [ ] Give the shop's manager the staff PIN
- [ ] Send them the kitchen screen setup guide (any browser →
      `<shop-domain>/staff` → log in → F11 for fullscreen → leave open)
- [ ] Confirm with the owner that delivery drivers know how to mark
      orders complete (if applicable)
- [ ] Send them their Stripe dashboard URL so they can see live orders
      and payouts

---

## Common gotchas

- **Build log shows "active shop is ricos"** — `SHOP_SLUG` env var not set
  on the new Pages project, or set on the wrong environment (Production
  vs Preview).
- **404 on the new domain** — DNS hasn't propagated yet, or the SSL cert
  is still provisioning. Wait 10 minutes.
- **Saved cards / customer accounts don't work** — `CUSTOMERS_KV` isn't
  bound, or the Stripe Connect `acct_xxx` in config.json is wrong.
- **Menu shows but prices are wrong** — `menu.json` (server source of
  truth) and `menu-visual.json` (display) have diverging IDs. They must
  match exactly per item.
- **Receipt email is in Rico's colours** — the new shop's config.json is
  missing the `theme` section; defaults kick in.
