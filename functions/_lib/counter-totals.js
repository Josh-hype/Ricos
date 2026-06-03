/* Shared "price a counter sale" logic for the EPOS cash + card paths.

   Both /api/staff/counter-order and /api/staff/terminal/charge must agree on the
   amount to the penny — the card flow authorises a card_present PaymentIntent for
   it, then counter-order re-checks the captured amount against a fresh recompute
   before marking the order paid. Keeping the computation here once guarantees they
   can't drift. Server-authoritative: the till sends items + mode + address, never
   prices. Counter sales suppress the online promo AND the platform service fee. */

import { computeTotals } from './totals.js';
import { resolveDelivery } from './delivery.js';

const MODES = new Set(['walkin', 'collection', 'delivery']);

// → { ok:true, mode, fulfillment, totals, address } | { ok:false, error }
export async function priceCounterSale({ items, mode, address: rawAddress }, config) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { ok: false, error: 'Add at least one item before charging.' };

  const m = MODES.has(mode) ? mode : 'walkin';
  const fulfillment = m === 'delivery' ? 'delivery' : 'collection';

  let address = null;
  let deliveryFeeP;
  if (m === 'delivery') {
    if (!config.fulfillment.delivery.enabled) {
      return { ok: false, error: 'Delivery is not configured for this shop.' };
    }
    const dq = await resolveDelivery(rawAddress?.postcode, config);
    if (!dq.ok) return { ok: false, error: dq.reason };
    deliveryFeeP = dq.feePence;
    const line1 = String(rawAddress?.line1 || '').trim().slice(0, 120);
    if (line1.length < 2) return { ok: false, error: 'Please enter a delivery address.' };
    address = {
      line1,
      line2: String(rawAddress?.line2 || '').trim().slice(0, 120),
      city: config.business.address.city,
      postcode: dq.postcode,
      notes: String(rawAddress?.notes || '').trim().slice(0, 280),
    };
  }

  const totals = computeTotals(
    { items: list, fulfillment, deliveryAddress: address ? { postcode: address.postcode } : undefined },
    config,
    { suppressPromo: true, suppressServiceFee: true, deliveryFeeP: deliveryFeeP ?? undefined },
  );
  if (!totals.ok) return { ok: false, error: totals.reason };

  return { ok: true, mode: m, fulfillment, totals, address };
}
