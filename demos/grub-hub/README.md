# The Grub Hub — homepage (standalone demo)

Self-contained static site for **grubhubyork** (placeholder content).

- `index.html` — the page (references `logo.png`, loads Google Fonts).
- `logo.png` — the current Grub Hub logo (transparent).

## Deploy (Cloudflare Pages)
New Pages project → connect this repo → **Build command:** *(leave blank)* → **Build output directory:** `demos/grub-hub`. No env vars / KV / Stripe needed.

Edit `index.html` and push to redeploy. To swap the logo, replace `logo.png`.

_Placeholders to update: address, opening hours, prices, social links, the Order button._
_When the business signs up for online ordering, this graduates to a full platform shop under `data/shops/grub-hub/`._
