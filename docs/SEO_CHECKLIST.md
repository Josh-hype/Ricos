# SEO checklist — run once per shop

Tick-box SEO runbook. Run it for every shop we onboard, right after the site is
live (Phase 6 of [`SHOP_CHECKLIST.md`](SHOP_CHECKLIST.md)).

**Time:** ~45 min of your work per shop, plus ~15 min from the owner (they have
to grant Google Business Profile access — you can't do that bit for them).

---

## The one thing to understand first

For a local takeaway, **Google Business Profile beats the website.** Someone
searching "chinese takeaway york" or "fish and chips near me" gets a map pack
first, and that comes from GBP, reviews and proximity — not from the site.

So the order of impact is:

| Rank | Lever | Where it lives |
|------|-------|----------------|
| 1 | Google Business Profile | Google, not us |
| 2 | Reviews (count, recency, replies) | Google, driven from our receipts |
| 3 | The shop's own landing page + schema | This repo (mostly automatic) |
| 4 | Location / cuisine pages | This repo |
| 5 | Directory citations | Third-party sites |

Do them in that order. Phases 3–5 below are cheap for us because the platform
generates most of it — but they will not outrank a well-run GBP on their own.

**We do NOT publish auto-generated blog posts.** Nobody reads a blog before
ordering a kebab, and Google's scaled-content-abuse policy targets exactly that.
Effort goes into the five levers above.

---

## Phase 0 — Collect from the owner (~15 min, them)

Ask for these in the intake form ([`SHOP_INTAKE_FORM.md`](SHOP_INTAKE_FORM.md)
§8) before you start:

- [ ] Facebook page URL
- [ ] Instagram URL
- [ ] TikTok URL (if any)
- [ ] Do they already have a Google Business Profile? If yes, ask them to add
      us as a **Manager** (Google Business Profile → Settings → Managers).
      If no, we create one and they verify it (a postcard to the shop, ~5 days).
- [ ] 5–10 good photos: the shopfront, the inside, and the best-selling dishes.
      Phone photos are fine; blurry ones are not.
- [ ] Which 3 dishes they most want to be found for.
- [ ] The areas they actually deliver to, in the words locals use
      ("Acomb", "Bishopthorpe", not just postcodes).

## Phase 1 — What the build already does (verify, don't rebuild)

Every shop gets these automatically from `config.json` — you only need to
confirm they came out right:

- [ ] `SHOP_SLUG=<slug> npm run build`, then open `public/index.html` and check
      the `<script type="application/ld+json">` block has: `Restaurant`, the
      real address, `telephone`, `openingHoursSpecification`, `servesCuisine`,
      `priceRange`.
- [ ] `<link rel="canonical">` points at the live domain (not `.pages.dev`).
- [ ] `og:` and `twitter:` tags present; `og:image` resolves.
- [ ] `public/sitemap.xml` and `public/robots.txt` generated, and `robots.txt`
      ends with an **absolute** `Sitemap: https://<domain>/sitemap.xml` line. A
      relative path there is invalid and Google silently ignores it, which
      disables sitemap auto-discovery.

If any of these are wrong it's a `config.json` problem, not a template problem.

## Phase 2 — Fill in the shop's `seo` block (~5 min)

In `data/shops/<slug>/config.json`:

- [ ] `seo.cuisine` — 3–6 items, the words customers search
      (`["Pizza", "Kebab", "Burgers"]`)
- [ ] `seo.priceRange` — `"£"` or `"££"`
- [ ] `seo.addressRegion` — e.g. `"North Yorkshire"`
- [ ] `seo.description` — 140–160 chars, mentions **cuisine + town +
      collection/delivery**. This is the line that shows in Google results, so
      write it for a human, not a crawler.
- [ ] `seo.sameAs` — **the Facebook / Instagram / TikTok URLs from Phase 0.**
      This is how Google ties the site, the socials and the Business Profile
      into one business entity. Empty on most shops today — fill it.
- [ ] `business.domain` — the real custom domain, no `www`, no trailing slash.
- [ ] Rebuild and re-check Phase 1.

## Phase 3 — Google Business Profile (~20 min — the big one)

This outranks everything else we do. Don't skip it because it's not code.

- [ ] Claim / create the profile; get it verified.
- [ ] **Primary category** exact (e.g. "Fish and chips takeaway", "Pizza
      restaurant"). This single field drives most of the map-pack ranking.
- [ ] Secondary categories for the other cuisines.
- [ ] Name, address, phone **character-for-character identical** to
      `config.json`. Mismatches actively hurt.
- [ ] Opening hours identical to `config.json` hours (and set special hours for
      closures — the same closure we put in `config.json`).
- [ ] Website link → the shop's domain. Add the **menu link** → `/order`.
- [ ] Upload the Phase 0 photos.
- [ ] Turn on messaging only if the shop will actually answer it.
- [ ] Set the service area to the delivery area.

## Phase 4 — Reviews (the highest-leverage ongoing thing)

- [ ] Get the shop's Google review short link
      (GBP → Ask for reviews → copy link).
- [ ] Add it to the thank-you page / order confirmation for that shop.
- [ ] Tell the owner: **ask every happy customer, reply to every review**,
      good or bad. Recency counts, so a steady trickle beats a burst.

> Never buy reviews, never write them, and never put `aggregateRating` schema on
> our own site for our own business — all three are against Google's guidelines
> and risk the profile.

## Phase 5 — Location / cuisine pages (~15 min per page)

Only worth doing for areas the shop genuinely serves. **A handful of good pages,
not dozens of spun ones.**

- [ ] Pick 2–4 areas from Phase 0 (e.g. Acomb, Holgate, Bishopthorpe).
- [ ] One page each: real copy about delivering that cuisine to that area,
      delivery time and fee, a link to `/order`, and the dishes from Phase 0.
- [ ] Link them from the shop's landing page so they're crawlable.
- [ ] Distinct `<title>` and meta description per page — no duplicates.

## Phase 6 — Citations (~10 min)

Same name / address / phone as `config.json` everywhere:

- [ ] Bing Places
- [ ] Apple Business Connect (drives Apple Maps)
- [ ] Facebook page — address, hours, website link
- [ ] Yell / Thomson Local / TripAdvisor if the shop wants them

## Phase 7 — Verify and monitor

- [ ] Add the domain to **Google Search Console**; submit `sitemap.xml`.
- [ ] Run the live URL through Google's **Rich Results Test** — the Restaurant
      schema should validate with no errors.
- [ ] Check the site on a phone: it should be readable and fast.
- [ ] Search `<cuisine> <town>` in an incognito window and note where they land
      — that's the baseline to measure against.

## Ongoing (monthly, ~10 min per shop)

- [ ] Review count going up? If flat, the shop has stopped asking.
- [ ] Search Console: any crawl errors, any new queries worth a page?
- [ ] Hours still correct (especially after a closure or a seasonal change).
- [ ] Any new dishes worth adding to `seo.cuisine`?

---

## Platform improvements (do once, every shop inherits)

These are shared-code changes — not per-shop work. Ticking one here upgrades
every existing and future shop on the next deploy.

- [x] `geo` (lat/lng) in the Restaurant schema — **support shipped**, but it is a
      per-shop value, not automatic. The build has no network (pure Node
      built-ins) so it can't geocode at deploy time. Set it per shop: open
      `https://api.postcodes.io/postcodes/<POSTCODE>` in a browser and paste the
      numbers into `seo.geo` as `{"lat": …, "lng": …}`. Don't guess them.
- [x] `areaServed` from the delivery config — a `GeoCircle` for radius shops
      (needs `seo.geo` to be set) and `PostalCodeRangeSpecification` entries for
      outcode shops. Live on Rico's and Mega Chippy.
- [x] `potentialAction` / `OrderAction` so Google can surface an "Order online"
      button. Declares only the fulfilment methods the shop actually offers.
- [ ] Structured `Menu` / `MenuItem` data generated from `menu.json`.
- [ ] `FAQPage` schema for delivery area, opening times and allergens.
- [x] `og:image` from a food photo rather than the logo — logos preview badly
      when a link is shared on WhatsApp or Facebook. Set `seo.ogImage` to a
      1200×630 image (relative to the site root); the card upgrades to
      `summary_large_image` automatically. Falls back to the logo when unset.
- [x] `og:title` carries the town (`Big Bites — Easingwold`), because people
      search and share the brand *with* its location and a bare trading name is
      ambiguous across towns.
- [x] `{{seoHead}}` added to `templates/landing-default.html`, so a new shop
      scaffolded without a bespoke landing page gets schema, canonical and OG
      tags automatically instead of none. Shops with no `business.domain` emit
      nothing rather than a broken `https:///` canonical.

**Still missing it:** `data/shops/grub-hub/index.html` has its own landing page
with **zero** `{{tokens}}`, so it emits no schema, no canonical and no OG tags.
Adding `{{seoHead}}` is a one-line fix, but do it *after* correcting
`seo.sameAs` — it still points at the previous brand's socials, and publishing
those would tell Google the wrong profiles belong to the shop.

Anything added here ships to all shops at once, so test on more than one
(see the golden rules in `CLAUDE.md`).
