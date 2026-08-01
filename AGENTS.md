# Agent instructions — read before changing anything

**Full project guide: [`CLAUDE.md`](CLAUDE.md). Read it first.** This file is the
short version for a UI session on the Big Bites homepage.

## Scope for this branch (`gpt`)

You are restyling **one shop's landing page**. Work ONLY inside:

- `data/shops/food-station/index.html` — the Big Bites homepage (self-contained:
  its CSS and JS live in this one file)
- `data/shops/food-station/order.css` — optional per-shop skin appended to the
  shared order page
- `data/shops/food-station/assets/` — this shop's images

**Do not touch** `templates/`, `functions/`, `scripts/`, `app/`, or any other
`data/shops/*` folder. Those are shared across five live restaurants, and pushes
to `main` touching `templates/staff/**` or `scripts/build-shop.js` auto-deploy
over the air to physical till hardware in the shops.

## Hard rules

1. **Push only to the `gpt` branch.** Never `main` (three live sites build from
   it), never `dev`. Your work gets reviewed and merged for you.
2. **Never commit or edit `public/` or `data/_active/`.** They are build outputs,
   regenerated on every deploy and gitignored. Edits there vanish; committing
   them once took a live shop's menu down.
3. **No external scripts or CDNs.** Production enforces
   `script-src 'self' https://js.stripe.com`. A GSAP/jQuery/unpkg `<script src>`
   works locally and is silently blocked live. Inline `<script>` is fine — the
   build externalises it automatically. Fonts: only `fonts.googleapis.com` /
   `fonts.gstatic.com` are allowed by CSP.
4. **Keep the `{{tokens}}`** (`{{shopCity}}`, `{{shopPhone}}`, `{{seoHead}}`,
   `{{deliveryAreaDescription}}`…). They are substituted at build time from the
   shop config. Replacing them with literal text breaks the multi-tenant build.
5. **No invented claims.** Star ratings, review counts, order counts and offers
   render ONLY from `window.BIG_BITES_CLAIMS` (top of `index.html`), which the
   owner fills with real figures. Do not hardcode "4.8", "500+ customers" or
   similar anywhere — a fabricated rating is a banned commercial practice in the
   UK (DMCC Act 2024). Leave the nulls null.
6. **Keep the accessibility floor:** WCAG AA contrast, 44×44px minimum tap
   targets, `prefers-reduced-motion` respected, scroll-reveal must not hide
   content when JS is off (the existing `js-reveal` pattern does this — keep it).
7. **Animate only `transform` and `opacity`** so everything stays compositable.

## Verify before you finish

```
SHOP_SLUG=food-station npm run build
```

Must end with `build-shop: active shop is "food-station"`. Pure Node built-ins —
no `npm install` needed. Then check there is no horizontal overflow at 320px and
1920px, and that the page works with JavaScript disabled.

## Context you'll want

- Brand: yellow `#F7C61A`, red `#E32619`, charcoal `#0C0C0C`, cream `#FBF3DE`,
  true-black page background. Display face is **Luckiest Guy** (the logo font),
  body is **Montserrat**. Vector brand assets live in `docs/brand/big-bites/`.
- The hero photograph (`assets/hero.jpg` / `.webp` + 800w variants) is lit on
  near-black and is bled off the right edge on purpose; its left/top/bottom
  edges are feathered with CSS masks so it sits directly on the page.
- The design being iterated matches a reference mock: two-column hero on all
  sizes, tilted torn edge into a red CTA band, order cards side by side.
