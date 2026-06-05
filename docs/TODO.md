# TODO / backlog

Running list of agreed follow-ups. Newest at the top.

## Payments — split / part payment
- [ ] **Refund a split payment.** A split order (`paymentMethod: 'split'`, with
      `payment.parts[]`) can't currently be refunded from the till — `refund.js`
      only handles `paymentMethod === 'card'`. Needs: refund the card part(s) via
      their stored `intentId`, return/adjust the cash part as a manual note, and
      cap the refundable to what was actually taken. Also handle cancelling a
      split paid order (currently it voids without refunding the card part).
- [ ] Split when settling an **existing** unpaid order (currently new sales only).
- [ ] **Per-unit** item splitting (today a multi-qty line is assigned whole).
- [ ] Item split across **more than 2 people**.

## Notes
- Split foundation already shipped: `payment.parts[]` (cumulative), partial card
  charges (`terminal/charge` / `pay.js` `amountP`), Z-report attribution by part.
