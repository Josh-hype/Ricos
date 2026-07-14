# TODO / backlog

Running list of agreed follow-ups. Newest at the top.

## Mega Chippy — migrate fully to `acombmegachippy.uk`, retire `megachippy.co.uk`
Owner is **reselling `megachippy.co.uk`**, so it must be taken out of the system
entirely — everything moves to `acombmegachippy.uk`. This is a full migration;
`megachippy.co.uk` is baked into several places. **Do the steps IN ORDER — the
till is currently hard-wired to `megachippy.co.uk`, so pulling it early breaks
the shop (this exact thing took the till down on 2026-07-14).**

- [ ] **PREREQUISITE — make `acombmegachippy.uk` actually work first.** Its
      checkout is currently broken: the page loads but `/api/*` doesn't serve on
      that hostname (`/api/config` returns nothing). Attach `acombmegachippy.uk`
      as a **Custom Domain on the `mega-chippy` Pages project** (Workers & Pages →
      mega-chippy → Custom domains), wait for Active, then confirm
      `https://acombmegachippy.uk/api/config` returns the same JSON as
      megachippy.co.uk **and a test order completes**. Nothing else proceeds until
      this passes.
- [ ] **Re-register the wallet domain** for the new host: log into
      `https://acombmegachippy.uk/staff` and hit `/api/staff/wallet-domain`
      (expect `applePay/googlePay: active`). Apple/Google Pay register against the
      exact host, so the megachippy.co.uk registration won't cover the new domain.
- [ ] **Email:** verify `acombmegachippy.uk` in Resend (SPF/DKIM DNS) and set
      `RESEND_FROM_EMAIL` = `orders@acombmegachippy.uk` on the mega-chippy Pages
      project. (Confirmation emails currently send from `orders@megachippy.co.uk`.)
- [ ] **Canonical/SEO:** set `data/shops/mega-chippy/config.json` `business.domain`
      back to `acombmegachippy.uk` (it was reverted to megachippy.co.uk on
      2026-07-14 because ordering was broken there). Rebuild + deploy.
- [ ] **Move the TILL to the new backend** — `app/web/provision.js` `DIRECTORY`
      maps Restaurant ID `318181` → `https://megachippy.co.uk`. Change it to the
      new host (use the live host, not a bare apex that 301-redirects). This is a
      staff/app change → **OTA**: it publishes a new LumiPOS bundle. After the
      OTA, the till must **re-provision** (Restaurant ID + setup password) OR the
      stored `epos_api_base` must be updated, so it talks to the new domain.
      **Verify the till logs in on the new domain BEFORE removing the old one.**
- [ ] **Only now: remove `megachippy.co.uk`** as a Custom Domain on the Pages
      project, so the resold domain no longer touches this shop.
- [ ] **Heads-up on Google:** the Google Business Profile / search presence is on
      `megachippy.co.uk`. Reselling it means that presence can't be redirected
      long-term — plan to update the Google Business Profile website + rebuild SEO
      on `acombmegachippy.uk`.

## Payments — split / part payment
- [x] **Refund an in-person counter-card sale.** `refund.js` + `status.js` now
      accept `paymentMethod === 'counter_card'` (single PI), so a Terminal sale is
      refundable in-app and auto-refunded on cancel. (2026-07 review.)
- [ ] **Refund a split payment.** A split order (`paymentMethod: 'split'`, with
      `payment.parts[]`) still can't be refunded from the till — it carries
      multiple card PIs (one per part). Needs: refund the card part(s) via their
      stored `intentId`, return/adjust the cash part as a manual note, and cap the
      refundable to what was actually taken. Also handle cancelling a split paid
      order (currently it voids without refunding the card part).
- [ ] Split when settling an **existing** unpaid order (currently new sales only).
- [ ] **Per-unit** item splitting (today a multi-qty line is assigned whole).
- [ ] Item split across **more than 2 people**.

## Notes
- Split foundation already shipped: `payment.parts[]` (cumulative), partial card
  charges (`terminal/charge` / `pay.js` `amountP`), Z-report attribution by part.
