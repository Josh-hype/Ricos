# Phase 3 — Stripe Terminal (card at the counter)

> Status: **scope / decision pending.** This doc lays out the path to capturing a
> real card payment from the EPOS Sale view. Nothing here is wired yet — the native
> `collectCardPayment` is still a `terminal-not-wired` stub, and `counter_card`
> currently marks an order **paid with no capture** (P2-10), gated only by the `sell`
> permission. This is the plan to close that.

## The decision you have to make first: which reader?

The handoff lists three options. Verified facts (June 2026, Stripe docs) that decide it:

| Option | Hardware | How it captures | Verdict |
|--------|----------|-----------------|---------|
| **Tap to Pay on the T2** | none (device NFC) | Terminal SDK, local NFC reader | ⚠️ **Likely ineligible.** Stripe's Tap-to-Pay-on-Android supported Sunmi models are **L3, V3/V3H/V3 Mix, T3 PRO** — the **T2 is not listed**, and Tap to Pay *requires* an integrated NFC sensor + GMS + locked bootloader + a security patch < 12 months. The T2 is a dual-screen desktop till that generally has **no NFC**. Confirm the exact unit, but assume no. |
| **BBPOS WisePOS E** | ~£59–£249 reader | Terminal SDK (Android) **or** server-driven | ✅ **Recommended.** Fully Stripe-supported, PIN entry for high-value, independent of the T2's NFC. Sits on the counter next to the T2; the app discovers + connects to it via the Terminal SDK. |
| **QR / hosted link** | none | regular PaymentIntent + QR the customer scans | ✅ **Cheapest interim.** No reader, no Terminal SDK — reuse the web PI flow, render a QR/short link, customer pays on their own phone. Slower at a busy counter and depends on the customer's phone, but ships fastest and works on every device. |

**Recommendation:** **WisePOS E** for the real "tap at the counter" experience, with
**QR** as a zero-hardware interim if you want card-at-counter live before a reader
arrives. Treat **T2 Tap to Pay as off the table** unless Stripe confirms your specific
unit. *(Owner action: check the T2's model/NFC against Stripe's supported-device list,
and decide reader — see the question in chat.)*

The server work below (connection-token endpoint + `card_present` PI + capture-on-
confirm) is **identical for Tap to Pay and WisePOS E** — only the native reader
discovery/connection differs. QR is a different, simpler flow (no Terminal SDK).

## Server (reader-agnostic — Tap to Pay & WisePOS E)

All three new pieces live on the shop's **connected account** (direct charges), so every
Stripe call passes `Stripe-Account: <connectedAccountId>` — the existing `call()` helper
in `functions/_lib/stripe.js` already supports this via `opts.stripeAccount`.

**1. Connection-token endpoint** — `functions/api/staff/terminal/connection-token.js`
```js
// POST — staff-gated; mints a Terminal connection token on the shop's connected account.
import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { createConnectionToken } from '../../../_lib/stripe.js';
export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell'); // bearer-token app is exempt from CSRF
  if (denied) return denied;
  const acct = getConfig().payments?.stripe?.connectedAccountId;
  const { secret } = await createConnectionToken(acct, env);
  return Response.json({ secret });
};
```
New `stripe.js` wrapper:
```js
export async function createConnectionToken(connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/terminal/connection_tokens', {}, env, opts);
}
```

**2. `card_present` PaymentIntent (manual capture)** — extend `createPaymentIntent`
with a `cardPresent` branch (instead of `automatic_payment_methods`):
```js
if (cardPresent) {
  body.payment_method_types = ['card_present'];
  body.capture_method = 'manual';            // authorise on confirm; we capture after
} else { body.automatic_payment_methods = { enabled: true }; }
```
Amount is still fixed server-side (`amountP = totals.totalP`), idempotency-keyed `pi_<orderId>`,
`application_fee_amount` when configured — same guarantees as web (no client-set price).

**3. Capture + verify (closes P2-10)** — split the `counter_card` path into two steps so an
order is marked **paid only after a real capture**, mirroring the web PI-match guard (P1-7):
- `POST /api/staff/counter-order` with `tender:'card'` → create the order **`payment.state:'pending'`**
  (NOT paid), compute totals, create the `card_present` PI, return `{ orderId, clientSecret }`.
- Native collects on the reader (authorises the PI).
- `POST /api/staff/counter-order/[id]/capture` → `retrievePaymentIntent`, assert
  `status === 'requires_capture'` **and** `amount === totals.totalP` **and** `currency === 'gbp'`
  **and** `metadata.orderId === id`, then capture (`/payment_intents/{id}/capture`), and only
  now set `payment.state:'paid'` + audit. Add a `capturePaymentIntent` wrapper to `stripe.js`.

This also lets refunds work on counter card sales: store `payment.intentId` so the existing
refund path applies (today `canRefund` excludes `counter_card` — P3-54 — because there's no PI).

## Native (reader-specific)

`EposHardwarePlugin.collectCardPayment({ amountP, currency, orderDraft })` (Kotlin) wires the
Stripe Terminal Android SDK:
1. `Terminal.initTerminal(...)` with a `ConnectionTokenProvider` that calls the endpoint above
   (through the app's authenticated fetch, so it carries the bearer token).
2. **Discover + connect** the reader — *Tap to Pay*: the local NFC reader; *WisePOS E*: discover
   over internet/Bluetooth and connect. (This is the only branch that differs by reader.)
3. `retrievePaymentIntent(clientSecret)` → `collectPaymentMethod` → `confirmPaymentIntent`.
4. `call.resolve({ ok:true, paymentIntentId, last4 })` → the JS Sale flow calls the capture
   endpoint, then submits / finalises the `counter_card` order.

Gradle deps (see `app/native/android/README.md`): `com.stripe:stripeterminal-core` +
`com.stripe:stripeterminal-taptopay` (Tap to Pay) **or** the reader-connection module for
WisePOS E. Tap to Pay also needs NFC + location permissions + Play Services + Stripe device
eligibility — the reason it's likely a non-starter on the T2.

## Test plan (Stripe TEST mode)
- Use Stripe's **simulated reader** (`SimulatedReader`) for the native flow first — no physical
  reader needed to prove the connection-token → collect → confirm → capture loop.
- Verify the order goes `pending → paid` **only** after capture; a collected-but-not-captured PI
  must NOT mark the order paid.
- Confirm the capture endpoint rejects an amount/currency/orderId mismatch (the P1-7 guard).
- Then swap in the real reader on-device.

## Owner actions / open questions
- **Decide reader** (above). If WisePOS E: order one; if QR: we can ship without hardware.
- Confirm whether counter card refunds are wanted day one (drives storing `payment.intentId`).
- Tap to Pay only: get the specific T2 model confirmed against Stripe's supported-device list.
