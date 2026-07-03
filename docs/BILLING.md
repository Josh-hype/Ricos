# LumiPOS subscription billing (charging the shops)

This is the **platform's** revenue — Lumin Labs charging each shop a fixed
**weekly** fee. It is completely separate from the customer-facing ordering flow
and from Stripe Connect: here the shop is an ordinary **Customer of the platform
Stripe account**, paying by **Bacs Direct Debit**. Stripe Billing does the
weekly charge, retries and receipts; we just set up the catalogue, the customers
and a one-time Direct Debit mandate link.

## What each shop pays (weekly)

| Item                | Price/wk | Rico's | Food Station |
|---------------------|---------:|:------:|:------------:|
| LumiPOS Software    |   £10    |   ✓    |      –       |
| LumiPOS Till Hardware | £15    |   ✓    |      –       |
| LumiPOS Card Terminal | £10    |   ✓    |      –       |
| LumiPOS Weekly (Food Station, all-in) | £19 | – | ✓ |
| **Total**           |          | **£35**| **£19**      |

Amounts live in `scripts/setup-billing.mjs` (`CATALOGUE`, in pence) — the source
of truth. Rico's is billed as three itemised Prices; **Food Station is on a single
agreed all-in £19/wk Price** (`lumipos_food_station_weekly`), so it isn't the
software+hardware breakdown.

## One-time prerequisite

Enable Bacs Direct Debit on the **platform** Stripe account:
**Dashboard → Settings → Payment methods → Bacs Direct Debit → turn on.**

## Setting it up

Run from the repo root with the platform secret key.

**Rehearse in test first** (no real money). Use Stripe's test bank details on the
mandate page: sort code `20-00-00`, account `55779911`.

```sh
STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-billing.mjs
```

**Then go live:**

```sh
STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-billing.mjs
# or one shop at a time:
STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-billing.mjs food-station
```

The script is **idempotent**:
- creates each weekly Price once (found by `lookup_key`);
- creates one Customer per shop (matched by email + `metadata.lumipos_shop`);
- prints a **Direct Debit setup link** per shop **only if they have no active
  subscription yet** — so re-running never double-charges anyone.

## Finishing each shop

1. Send the shop its setup link (the script prints one per shop; links last ~24h —
   re-run to mint a fresh one).
2. The shop opens it, enters its **bank account + sort code** and signs the Bacs
   mandate. Stripe creates the weekly subscription on completion.
3. **First payment** clears in ~3–5 working days (Bacs timing), then it bills
   **every week** automatically. Stripe emails the receipts.

## Ongoing

- **Failed payments:** Stripe marks the subscription `past_due`, retries on its
  Smart Retries schedule and emails the shop. Watch **Dashboard → Billing →
  Subscriptions**.
- **Add a shop:** add it to `SHOPS` in the script and re-run.
- **Change a shop's items/price:** edit the Subscription in the Stripe Dashboard
  (add/remove a Price line), or cancel and re-run the link. Editing `CATALOGUE`
  only affects *new* subscriptions, not ones already running.
- **VAT:** not configured here. If Lumin Labs is VAT-registered, enable Stripe Tax
  on these products.
- **Cancelling:** cancel the shop's subscription in the Stripe Dashboard.
