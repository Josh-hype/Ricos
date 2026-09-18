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
- **Delivery** — `radius` mode, three bands from the owner's own provider
  zones: 2 mi / £2 / £10 min, 4 mi / £3 / £10 min, 7 mi / £5 / **£20 min**
- **Logo** — `logo.png`, `assets/logo-mark.png` (1200×680) and a square
  `icon.png`, all derived from `_source/dominic-logo.png`, archived out of the tree on 17 Sep 2026 — restore it with `git checkout 09f3db4febb6 -- data/shops/dominic-pizza/_source/` if the logo ever needs regenerating (see `docs/ARCHIVED_ASSETS.md`). The header CSS was
  retuned: Acomb's was a 1:1 badge, Dominic's is a 1.77:1 wordmark, and the CSS
  sizes by height with `width:auto`, so the old 165px would have rendered it
  ~292px wide and into the nav. Now 96px tall / ~169px wide, the same footprint
  the badge had. Acomb's `left:-21px` nudges removed with it.
- **Theme reds and cream** sampled from the logo file: `#E7151A`, `#FBF6E8`
- **The menu** — 175 items in 18 categories, generated from the owner's
  workbook by `tools/_gen-dominic-menu.py`. Re-run that script to refresh it;
  do not hand-edit the two JSON files, they are generated output.

### Still to rebrand

| | Currently |
|---|---|
| item photos | none — every item shows "PHOTO COMING SOON". The workbook carried no images |
| `assets/` food photos, `order.css` | Acomb's — though the hero (pizza + doner) suits a shop whose logo reads "PIZZA · KEBABS · CALZONES", so it may be worth keeping |
| `theme.accent` | still Acomb's gold `#c9a227`. The logo's only other colour is Italian-flag green `#036B3A` — a design call, not a correction |
| `legalName`, `companyNumber` | placeholders (the build warns). `stripe.connectedAccountId` is **set** — `acct_1UGqDKBzGUOO3oql`, 18 Sep 2026 |

### Delivery: per-band minimums, and how the promo interacts

`radius` mode, origin = the owner's zone centre (53.9551430130456,
-1.07015141349182), `maxMiles` 7, and **no `roadFactor`** — their zones are
circles on a map, so their real area is straight-line; applying Rico's ~1.3
road factor would shrink it and start refusing addresses they serve today.

Each band carries its own `minOrderPence`, which needed a small shared-code
addition (`resolveDelivery` returns the matched band's minimum; `computeTotals`
and the order page prefer it over the flat `minimumOrderPence`). A band without
one falls back to the flat value, so every other shop is untouched.

**The minimum is measured BEFORE the discount** — owner's decision, to match
the system they came from, whose promo threshold is also read off the gross
subtotal. So £20 means £20 of menu items: a £24.60 basket is accepted on the
7-mile band even though 20% off nets £19.68. That's
`fulfillment.delivery.minimumBeforeDiscount: true`; absent (every other shop)
keeps the after-discount behaviour, which is what Rico's and Big Bites use.

### Check before launch, inherited and not obviously wrong

- **Two items are missing on purpose.** Lamb Shish Kebab and Lamb Shish Wrap
  are "Sold out" in the workbook with a BLANK price, so importing them would
  have put £0 orderable items on the menu. Add them with real prices when they
  are back on.
- **The Special Offers get the 20% too** — owner's decision, 17 Sep 2026, to
  match their existing FoodBooking page. So Meal Deal 1 sells at £16.00 against
  £19.90 for the cheapest possible parts (2 × 11" Margherita + a Pepsi bottle).
  `NO_PROMO_CATEGORIES` in `tools/_gen-dominic-menu.py` is empty for that
  reason — it is a priced commercial decision, not an oversight, so don't put
  it back without asking.
- **`business.email`** is the right *shape* but nothing receives it yet: the
  domain needs verifying in Resend, `RESEND_FROM_EMAIL` setting, and MX /
  Email Routing if `orders@` is to accept replies.

**The build cannot warn you about any of that.** It only flags fields that are
*missing* — `legalName`, `companyNumber` and `stripe.connectedAccountId`, which
were never filled in for Acomb either. A field that is confidently **wrong**
looks identical to a correct one. Don't read a quiet build as a finished
rebrand; work the table above.

### Card is taken on the shop's OWN machine

`pos.externalCardMachine: true` (owner, 18 Sep 2026). Pressing **Card** on the
till **records the sale as paid by card** there and then — counter sale, paying
off an existing order, and the card half of a split. There is no LumiPOS reader
to drive, so the Back Office no longer offers to register one.

Two consequences to know before the shop asks:

- **Refunds on a counter card sale must be done on their own machine.** LumiPOS
  never touched that money and there is no PaymentIntent, so the till answers
  "This order has no refundable card payment" — correct, not a fault. Cancelling
  the order still works.
- **Takings still show it as card** (`paymentMethod: 'counter_card'`), and the
  Lumin Labs fee and Stripe cost both come out at **£0** for these sales, which
  is right: both figures key off `payment.intentId`, and an external sale has
  none.

This is independent of the website — online card payments still go through
Stripe once `stripe.connectedAccountId` is real. Same setup as Big Bites and
One Sip.

### Caller ID (working — but the host must stay set)

The handsets plug into the **FRITZ!Box FON port**, so there is no analogue line
for a USB modem: `pos.callerId.mode` is `"fritzbox"` and the till listens to the
router's own call monitor on TCP **1012**. Someone dialled **`#96*5*`** on a
handset to open that port; it survives reboots but not a factory reset.

`host` is **pinned to `192.168.178.1`** and should stay pinned. The fallback
(read the till's DHCP gateway) is wrong here twice over — the T2 is on the
separate WiFi box rather than the FRITZ!Box, and the lookup needs
`ACCESS_WIFI_STATE`, which the APK installed on this till doesn't declare. The
explicit host skips the lookup, so it works on the APK already on the counter.
`192.168.178.1:1012` was verified on site on 17 Sep 2026 with `nc`, against a
real incoming call. If the router is replaced or its subnet changed, change this
with it.

### Not carried over on purpose

- **`pos.ordersOnly`** — Acomb is LumiWEB, so it hid the counter mode bar and
  the card-reader tile. Dominic is buying the full EPOS, so it's been removed;
  leaving it would have hidden the counter sales they're paying for.
- **`reference/` and `_reference-src/`** — Acomb's landing-page design source.
  Never build inputs, and archived out of the tree on 17 Sep 2026 along with
  every other shop's design originals (`docs/ARCHIVED_ASSETS.md`).

### Missing entirely

- **No `seo` block.** Inherited from Acomb, which never had one. Before launch
  add `cuisine`, `priceRange`, `addressRegion`, `description`, `ogImage` and
  `seo.geo` `{lat,lng}`. **Never guess the coordinates** — they decide where
  Google drops the pin.

---

## Before this shop takes a real order

- [ ] Work the rebrand table above, top to bottom
- [x] `stripe.connectedAccountId` — `acct_1UGqDKBzGUOO3oql`, set 18 Sep 2026.
      Confirm the account is charge-ready and the webhook secret is set with
      `<domain>/api/staff/stripe-test` (PIN-gated; reports both, and retrieves
      the account from Stripe rather than assuming)
- [ ] `business.legalName` + `companyNumber` — these print on the privacy and
      terms pages as the data controller
- [ ] Add a 6-digit Restaurant ID to `app/web/provision.js` → Dominic's custom
      domain (never a `*.pages.dev` — 403). Shared `app/web/` code, so merging
      it is a **fleet OTA deploy**
- [ ] Register the wallet domain — Phase 7b of `docs/SHOP_CHECKLIST.md`.
      Registration is per exact host, so nothing carries over from anywhere else
- [ ] **Remove `prelaunch`** — last, once everything above is true

Full runbook: `docs/ADDING_A_SHOP.md` / `docs/SHOP_CHECKLIST.md`.
