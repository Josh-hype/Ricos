# Lumin Labs — Owner Console (platform back office)

A private dashboard for the **platform owner** (you), separate from any shop's
staff till. It answers two questions across **every** shop at once:

1. **What is Lumin Labs earning?** — the £35/week subscriptions + the 50p
   per-order platform fee, plus how much has actually landed in Stripe.
2. **What is each client doing?** — order volume, gross takings, card-processing
   cost, and billing/subscription status.

It is **not** a shop. It has no menu, no order page. It's its **own hidden
Cloudflare Pages project** built from this same repo, selected by the
`PLATFORM_BUILD` environment variable instead of a `SHOP_SLUG`.

---

## How it gets its numbers

Everything is pulled **live from the Stripe _platform_ API** using the shared
platform secret key (the same `STRIPE_SECRET_KEY` every shop project already
uses). No shop KV or per-shop login is involved:

| Figure | Source |
|--------|--------|
| Lumin Labs per-order revenue + online order count | `application_fees` (one platform-level list covers all shops) |
| Each shop's gross volume (GMV), online vs in-person | `charges` on each connected account |
| £35/wk subscriptions + invoices | `subscriptions` / `invoices` on the platform account |
| Money actually banked by Lumin Labs | platform `balance` |

The shop list, Connect account ids, weekly fee and **card processor** live in
[`data/platform/registry.json`](../data/platform/registry.json).

### Processor-aware by design (Stripe today, Elavon next)

Card-processing fees are a **separate line** from Lumin Labs' revenue, because
they're the bit that's moving (Stripe → Elavon/MWBS for cheaper online rates).

- **Lumin Labs revenue** = subscription + per-order fee. It does **not** depend
  on who processes the card.
- **Card-processing cost** = the acquirer's cut, priced **per shop** from
  `registry.json → processors`. Switch a shop's `onlineProcessor` from `stripe`
  to `elavon` (and fill Elavon's real rates) and **only the cost line re-prices**
  — Lumin Labs' revenue is untouched.

> ⚠️ When a shop's online card actually moves **off** Stripe to Elavon, those
> orders stop generating a Stripe `application_fee` and stop appearing in Stripe
> `charges`. The dashboard shows **per-order fees _expected_ vs _collected_** so
> the gap (what Lumin Labs must now invoice another way) is visible. At that
> point you'll also want a non-Stripe order feed for those shops — the revenue
> model (`functions/_lib/platform-revenue.js`) is written to take order facts
> from any source, so that's a data-layer change, not a rewrite.

---

## One-time Cloudflare setup

Create a **new Pages project** on the **same** `josh-hype/ricos` repo:

- **Production branch:** `main`
- **Build command:** `npm run build`  *(required — outputs aren't committed)*
- **Build output directory:** `public`
- **Environment variables (Production _and_ Preview):**
  - `PLATFORM_BUILD` = `1`   ← this is what makes it the admin, not a shop
  - `NODE_VERSION` = `20`
- **Secrets (encrypted env vars):**
  - `STRIPE_SECRET_KEY` — the **platform** LIVE secret key (same value the shops use)
  - `SESSION_SECRET` — any long random string (signs the owner cookie). Generate: `openssl rand -hex 32`
  - `OWNER_PASSWORD_HASH` — keyed hash of your chosen password (see below)
  - `OWNER_USERNAME` — *(optional)* require a username too
- **KV (optional):** bind one namespace as `STAFF_LOGIN_KV` to rate-limit the
  login. Omit it and login still works, just without the lockout.
- **Custom domain:** a hidden one, e.g. `console.luminlabs.co.uk` (or just use
  the project's `*.pages.dev` URL). The build sets `noindex` + `robots: Disallow`.

### Generate `OWNER_PASSWORD_HASH`

Pick a strong password, then hash it **keyed by the same `SESSION_SECRET`** you
set above:

```sh
printf %s "your-strong-password" | openssl dgst -sha256 -hmac "your-SESSION_SECRET"
```

Paste the hex digest as `OWNER_PASSWORD_HASH`. (A plain `sha256` of the password
is also accepted, so you can upgrade later without downtime.) **Never commit the
password or the hash** — they live only in Cloudflare.

---

## Using it

Visit the project URL → sign in with the owner password. Then:

- **Revenue tab** — headline Lumin Labs revenue, per-order fees, subscription
  run-rate, GMV, card-processing cost, Stripe balance; plus a per-shop table.
  Switch the range: Today / 7d / 30d / 90d / All.
- **Clients & billing tab** — what each shop pays, their Connect status and
  processor, the live Stripe subscriptions, and recent invoices.

## Adding / changing a client

Edit [`data/platform/registry.json`](../data/platform/registry.json):

- Add the shop to `shops[]` with its `slug`, `name`, weekly fee and (once Connect
  is live) its `connectedAccountId`. A blank account id shows as **pending** and
  is skipped in Stripe aggregation.
- Set `live: true` to count it in the subscription run-rate.
- Set `subscription.since` (`YYYY-MM-DD`) when the weekly fee starts billing —
  revenue accrual is clamped to it, so wide ranges ("All time") never count
  weeks from before the shop was actually paying.
- Set `onlineProcessor` (`stripe` now; `elavon` once migrated — fill the Elavon
  rates under `processors.elavon` first).

Commit on `dev`, check the preview, merge to `main` — the console redeploys with
the rest of the platform. The live shop sites are unaffected (the admin code is
dormant unless `PLATFORM_BUILD=1`).

---

## Security model

- Hidden URL **+** owner login (HMAC-signed `HttpOnly; Secure; SameSite=Lax`
  cookie, 8-hour expiry), kept entirely separate from shop staff/manager sessions.
- `noindex` + `Disallow: /` so it can't be crawled.
- The admin API endpoints (`/api/admin/*`) are also deployed onto the shop
  projects (functions are shared), but they're **inert there**: every one returns
  `503 owner-login-not-configured` unless `OWNER_PASSWORD_HASH` is set, which only
  the admin project has. No shop figures leak.
- Read-only: the console never writes to Stripe or to any shop.
