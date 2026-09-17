# Dominic Pizza (`dominic-pizza`)

**LumiPOS** customer — the full EPOS on a **Sunmi T2** (counter sales, cash
drawer, Z report) plus the website. ~£35/wk. See `docs/PRODUCTS.md`.

---

## ⚠️ Read this first: the content in here is not Dominic's

This folder was copied wholesale from `data/shops/acomb-pizza-kebab` on
**17 Sep 2026**, so a Cloudflare Pages project could be created under the right
name and the T2 installed before Dominic's own details arrived.

**Everything below still says Acomb Pizza & Kebab House.** `prelaunch: true` is
set for exactly that reason — every page sends `X-Robots-Tag: noindex` and
`robots.txt` is `Disallow: /`, so another shop's real name, address and phone
cannot get indexed under this brand.

### Done (17 Sep 2026)

- `business.tradingName` / `shortName` → **Dominic Pizza**
- `business.address` → 3 Lawrence Street, York, YO10 3BP
- `business.phone` → 01904 621622 · `business.email` → orders@dominicpizza-york.co.uk
- `business.domain` → dominicpizza-york.co.uk
- `hours` → 4pm–3am, seven days (`16:00`–`27:00`)
- Landing `<title>` + meta description (both said "in Acomb, York")
- Footer opening hours — were **hard-coded** to Acomb's 11:45pm/12:45am closes
  and survived the rest of the rebrand. Now `{{openingHoursRows}}`, generated
  from `config.hours`, so they can't drift from what the ordering engine enforces.
- Delivery switched **off** — see below

### Still to rebrand

| | Currently |
|---|---|
| `logo.png` + `assets/logo-mark.png` | Acomb's logo, in the header and footer |
| `assets/` photos, `theme` colours, `order.css` | Acomb's brand |
| `menu.json` + `menu-visual.json` | Acomb's 141 items across 17 categories |
| Hero "FAST DELIVERY — Right to Your Door" badge, and the footer blurb | Promises delivery, which is off |
| `stripe.connectedAccountId`, `legalName`, `companyNumber` | placeholders (the build warns) |

### Delivery is off, and not because they don't deliver

`fulfillment.delivery.enabled` is `false`. What was inherited is Acomb's:
`mode: "zones"` with four hand-drawn polygons over Acomb, Poppleton, Rufforth,
Bishopthorpe and Clifton — the far side of York from Lawrence Street. Left
enabled it would price and accept deliveries against a map centred miles away,
and the shop's own postcode may not even fall inside any zone.

Replace the zones (or switch to `outcode`/`radius`) and set `enabled: true`
**together**. Don't flip the flag on its own.

### Check before launch, inherited and not obviously wrong

- **`promo.autoOnlineDiscount` is ENABLED** — 10% off orders over £12, and the
  landing page advertises it in two places. That was Acomb's commercial
  decision, not Dominic's. The server honours it, so the page isn't lying; it
  just may not be what this shop wants to give away.
- **`business.email`** is the right *shape* but nothing receives it yet: the
  domain needs verifying in Resend, `RESEND_FROM_EMAIL` setting, and MX /
  Email Routing if `orders@` is to accept replies.

**The build cannot warn you about any of that.** It only flags fields that are
*missing* — `legalName`, `companyNumber` and `stripe.connectedAccountId`, which
were never filled in for Acomb either. A field that is confidently **wrong**
looks identical to a correct one. Don't read a quiet build as a finished
rebrand; work the table above.

### Not carried over on purpose

- **`pos.ordersOnly`** — Acomb is LumiWEB, so it hid the counter mode bar and
  the card-reader tile. Dominic is buying the full EPOS, so it's been removed;
  leaving it would have hidden the counter sales they're paying for.
- **`reference/` and `_reference-src/`** — Acomb's landing-page design source.
  Still in their folder; they were never build inputs.

### Missing entirely

- **No `seo` block.** Inherited from Acomb, which never had one. Before launch
  add `cuisine`, `priceRange`, `addressRegion`, `description`, `ogImage` and
  `seo.geo` `{lat,lng}`. **Never guess the coordinates** — they decide where
  Google drops the pin.

---

## Before this shop takes a real order

- [ ] Work the rebrand table above, top to bottom
- [ ] `stripe.connectedAccountId` — Dominic's own `acct_…`; card money goes to
      their bank, so Acomb's could never have been reused even if it existed
- [ ] `business.legalName` + `companyNumber` — these print on the privacy and
      terms pages as the data controller
- [ ] Add a 6-digit Restaurant ID to `app/web/provision.js` → Dominic's custom
      domain (never a `*.pages.dev` — 403). Shared `app/web/` code, so merging
      it is a **fleet OTA deploy**
- [ ] Register the wallet domain — Phase 7b of `docs/SHOP_CHECKLIST.md`.
      Registration is per exact host, so nothing carries over from anywhere else
- [ ] **Remove `prelaunch`** — last, once everything above is true

Full runbook: `docs/ADDING_A_SHOP.md` / `docs/SHOP_CHECKLIST.md`.
