# Rico's Peri Peri

Online ordering for Rico's Peri Peri — char-grilled chicken, York. Cloudflare Pages frontend + Pages Functions backend, KV storage, Stripe / Resend / Twilio integrations.

## Repo layout

```
public/                  static site (Cloudflare Pages serves this)
  index.html             landing page
  order.html             menu and checkout
  thank-you.html         post-payment confirmation
  privacy.html, terms.html
  staff/                 PIN-gated orders dashboard (PWA)
  _headers, _redirects   Cloudflare Pages config
  robots.txt, sitemap.xml

functions/               Cloudflare Pages Functions (the backend)
  _middleware.js         security headers (CSP, HSTS, X-Frame, etc.)
  _lib/                  shared helpers (Stripe, Resend, Twilio, KV, auth, totals)
  api/
    config.js            GET public config + Stripe pk + slots
    menu.js              GET canonical menu
    order.js             POST create order
    stripe-webhook.js    POST Stripe events
    staff/               PIN-gated dashboard endpoints
    marketing/subscribe  POST footer signup form

data/                    editable shop policy (hours, fees, postcodes, promo)
  config.json

wrangler.toml            Cloudflare Pages config (KV bindings)
DEPLOY.md                step-by-step launch guide
```

## Local development

```sh
npm install
npx wrangler kv namespace create ORDERS_KV --preview
# (repeat for MARKETING_KV, SLOTS_KV, STAFF_LOGIN_KV)
# paste the returned ids into wrangler.toml

# .dev.vars holds local-only secrets — do NOT commit it
cat > .dev.vars <<'EOF'
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=orders@example.com
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+44...
STAFF_PIN_HASH=<sha256 of your pin>
SESSION_SECRET=<32+ random chars>
EOF

npm run dev
```

Open http://localhost:8788. Card payments use Stripe test mode.

## Production deployment

See `DEPLOY.md`.

## Editing the menu

Two source-of-truth files for now:

- `functions/_lib/menu.js` — canonical prices the server uses to compute
  totals. The client cannot override these.
- `public/order.html` — visual menu (photos, descriptions, categories).

When you change a price, update both. There's a roadmap entry to extract the
visual menu into `data/menu.json` so they share one source.

## Editing hours, postcodes, fees, promo

`data/config.json`. Push to main → Cloudflare auto-deploys.
