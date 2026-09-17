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

### Still to rebrand

| | Currently |
|---|---|
| `config.json` → `business.tradingName` / `shortName` | Acomb Pizza & Kebab House |
| `config.json` → `business.address` | 2 Front Street, York, YO24 3BQ |
| `config.json` → `business.phone` / `email` / `domain` | Acomb's |
| `config.json` → `hours` | Acomb's |
| `config.json` → `fulfillment.delivery` | Acomb's outcodes + fees |
| `logo.png`, `assets/`, `index.html`, `order.css` | Acomb's brand and landing design |
| `menu.json` + `menu-visual.json` | Acomb's 141 items across 17 categories |

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
