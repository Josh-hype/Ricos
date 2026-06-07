# Address finder (postcode → pick your address)

Lets customers (web checkout) and staff (the till, on delivery orders) pick their
address from a list instead of typing it. Powered by **Ideal Postcodes** (Royal
Mail PAF + Ordnance Survey licensed data). Shared code — ships to every shop, but
stays **dark until a key is configured**, with manual entry always as the fallback.

## What it costs (and why it's effectively free)

Ideal Postcodes bills per lookup (~4.5p on the small tier), **but every successful
result is cached per postcode, so a postcode is billed AT MOST ONCE — across ALL
shops.** A shop's delivery area is a fixed set of postcodes, so once each has been
seen, ongoing cost ≈ £0. A single small top-up seeds the whole area and lasts a
long time. Don't fear the auto-top-up: with caching the balance drains so slowly
it rarely triggers.

## Setup — per Cloudflare Pages project (Rico's, Food Station, every shop)

### 1. API key

One Ideal Postcodes account = one key, used by **every** shop (so all shops draw
from the same balance). Add it as an environment variable on **both Production and
Preview**:

- `IDEALPOSTCODES_API_KEY` = your key

The key works from our server by default — no "allowed URLs" whitelist is needed
(those only restrict browser requests; we call Ideal Postcodes server-side, so the
key is never exposed to the customer).

### 2. Shared cache — THIS is what stops double-charging across shops

Create **one** KV namespace (e.g. `lumipos_address_cache`) and bind it as
`ADDRESS_KV` on **every** shop's project:

- Pages project → **Settings → Functions → KV namespace bindings** →
  Variable name `ADDRESS_KV` → select the **one shared** namespace.
- Do this for Rico's, Food Station, and every future shop — all pointing at the
  **same** namespace.

Because the cache key is the postcode only (no shop prefix), a postcode looked up
on Rico's is then free on Food Station and any future shop. If `ADDRESS_KV` isn't
bound it falls back to each shop's own `CUSTOMERS_KV` (still caches within a shop,
but would bill once per shop for a shared postcode).

## Verifying it works

- `/api/config` returns `addressLookup.enabled: true` once the key is set — the
  order page + till then show the finder.
- **Cross-shop dedup:** look up a postcode on Rico's (balance drops by 1), then the
  **same** postcode on Food Station — the response carries `"cached": true` and the
  Ideal Postcodes balance does **not** drop again.

## Going live

Built on `dev` first (Cloudflare preview). Add the key + `ADDRESS_KV` to the
**Preview** env, test on the preview URL, then merge `dev` → `main` to go live on
every shop.
