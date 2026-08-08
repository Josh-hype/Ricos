/* Server-side total calculation. The frontend is NEVER trusted for prices.
   It sends item ids + quantities + modifier ids; we look up the canonical
   price from the menu and compute totals here. */

import { getMenu } from './menu.js';
import { normalisePostcode } from './postcode.js';

export function computeTotals(input, config, opts = {}) {
  // opts.menu lets the API layer inject a runtime (owner-edited) menu resolved
  // from KV; when absent we fall back to the static build-time menu. Kept sync so
  // the money tests and pure callers need no change.
  const menu = opts.menu || getMenu();
  const itemsById = indexMenu(menu);
  const lines = [];
  let subtotalP = 0;

  for (const line of input.items || []) {
    // Manual / off-menu line: the staff till lets an operator type a custom name
    // + price for something not on the menu. The price is staff-entered (there's
    // no menu reference to recompute from), so it's trusted ONLY when the caller
    // opts in — opts.allowCustom is set by the staff counter flow, never by the
    // customer web checkout, so a shopper can't inject a £0.01 line.
    if (line.custom) {
      if (!opts.allowCustom) return { ok: false, reason: 'Custom items are not allowed here.' };
      const qty = Math.max(1, Math.min(20, Math.floor(Number(line.qty)) || 1));
      const unitP = Math.max(0, Math.min(1000000, Math.round(Number(line.priceP) || 0)));
      const name = (typeof line.name === 'string' ? line.name.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() : '').slice(0, 80) || 'Custom item';
      const lineTotalP = unitP * qty;
      subtotalP += lineTotalP;
      lines.push({
        id: null, custom: true, name, qty, meal: false, spice: null,
        modifiers: [], mealChoices: [], notes: null,
        unitPriceP: unitP, lineTotalP,
      });
      continue;
    }
    const item = itemsById.get(line.id);
    if (!item) {
      return { ok: false, reason: `Unknown item: ${line.id}` };
    }
    // POS-only items (e.g. in-store student deals) exist in the menu for the till
    // but must never be orderable on the website. The staff counter flow opts in
    // via allowPosOnly; the customer web checkout never does.
    if (item.posOnly && !opts.allowPosOnly) {
      return { ok: false, reason: `Item not available online: ${line.id}` };
    }
    const qty = Math.max(1, Math.min(20, Math.floor(Number(line.qty)) || 1));
    let lineP = item.priceP;

    if (line.meal && item.mealAddP != null) lineP += item.mealAddP;

    // Modifiers (size, sauce, etc.) — each modifier contributes priceDeltaP.
    const modIds = Array.isArray(line.modifiers) ? [...new Set(line.modifiers)] : [];
    // Some modifiers are priced by the chosen size (pizza toppings + stuffed
    // crust cost more on a 13"). Such a modifier carries priceDeltaPBySize keyed
    // by the size modifier id; we find which size is selected and use its delta,
    // falling back to the flat priceDeltaP (used for 11" and every other item).
    const sizeKeys = new Set();
    for (const m of item.modifiers || []) {
      if (m.priceDeltaPBySize) for (const k of Object.keys(m.priceDeltaPBySize)) sizeKeys.add(k);
    }
    const activeSize = modIds.find(id => sizeKeys.has(id)) || null;
    const modSummaries = [];
    for (const modId of modIds) {
      const mod = item.modifiers?.find(x => x.id === modId);
      if (!mod) continue; // ignore unknown modifiers silently
      // Meal-only add-on (e.g. cheese on the meal's chips): only applies when the
      // line is actually a meal. Ignored — no charge, not recorded — without it.
      if (mod.whenMeal && !line.meal) continue;
      lineP += (mod.priceDeltaPBySize && activeSize && mod.priceDeltaPBySize[activeSize] != null)
        ? mod.priceDeltaPBySize[activeSize]
        : (mod.priceDeltaP || 0);
      modSummaries.push(mod.label);
    }

    // Meal side/dip/drink choices. Price-neutral (covered by mealAddP); we
    // validate per group and record the names for the kitchen ticket +
    // receipt. Validating each group against its own allow-list — and
    // capping to its count — stops a crafted request swapping in a chicken
    // side, a banned item, or extra picks it shouldn't get.
    const mealChoiceNames = [];
    if (line.meal && Array.isArray(item.mealChoose) && Array.isArray(line.mealChoices)) {
      const usedIdx = new Set();
      for (const group of item.mealChoose) {
        const allowed = allowedMealChoiceIds(group, menu);
        const cap = group.count || 1;
        let taken = 0;
        for (let i = 0; i < line.mealChoices.length && taken < cap; i++) {
          if (usedIdx.has(i)) continue;
          const id = line.mealChoices[i];
          if (!allowed.has(id)) continue;
          const chosen = itemsById.get(id);
          if (!chosen) continue;
          mealChoiceNames.push(chosen.name);
          usedIdx.add(i);
          taken++;
        }
      }
    }

    const lineTotalP = lineP * qty;
    subtotalP += lineTotalP;

    lines.push({
      id: item.id,
      name: item.name,
      qty,
      meal: !!line.meal,
      spice: typeof line.spice === 'string' ? line.spice.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 40) : null,
      modifiers: modSummaries,
      mealChoices: mealChoiceNames,
      // Per-item special instructions (free text) — capped + recorded for the
      // kitchen ticket / KDS. The client can't be trusted for length.
      notes: (typeof line.notes === 'string' && line.notes.trim()) ? line.notes.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 140) : null,
      unitPriceP: lineP,
      lineTotalP,
    });
  }

  // Reject an empty cart explicitly: a zero-item order would otherwise slip
  // past the final totalP > 0 check because the service fee alone keeps it
  // positive.
  if (lines.length === 0 || subtotalP <= 0) {
    return { ok: false, reason: 'Cart is empty.' };
  }

  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'collection';

  // Promo: percentage off the online subtotal. Counter sales (taken in-person at
  // the till) opt out via opts.suppressPromo — the online discount isn't intended
  // for walk-ins, and the customer is paying the menu price face-to-face.
  //
  // Two sources, first-order takes precedence (it's the bigger, more specific
  // welcome offer and shouldn't stack with the always-on discount):
  //   - opts.firstOrderDiscount {percent,label}: a signed-in customer within
  //     their first N orders. Eligibility is per-customer, so /api/order decides
  //     it and injects it here; a walk-in or guest never carries it.
  //   - config.promo.autoOnlineDiscount: the shop's standing "% off all online
  //     orders" offer, applied to everyone. OPTIONALLY gated on a minimum spend
  //     (minSubtotalPence) — Acomb Pizza & Kebab runs 10% off orders of £12 or
  //     more, so the offer can't be farmed on a £3 side. The gate is on the
  //     SUBTOTAL, before the service fee and delivery, which is the number the
  //     customer sees against the menu prices; testing it after fees would mean
  //     a £11.50 basket qualified once delivery was added, which reads as a bug
  //     from either side of the counter. Absent ⇒ no threshold, exactly the
  //     previous behaviour, so every other shop is untouched.
  let discountP = 0;
  let discountLabel = null;
  if (opts.firstOrderDiscount && !opts.suppressPromo) {
    const pct = Math.max(0, Math.min(100, Number(opts.firstOrderDiscount.percent) || 0));
    discountP = Math.min(subtotalP, Math.round(subtotalP * (pct / 100)));
    discountLabel = opts.firstOrderDiscount.label || `${pct}% off`;
  } else if (config.promo?.autoOnlineDiscount?.enabled && !opts.suppressPromo) {
    const auto = config.promo.autoOnlineDiscount;
    const minP = Math.max(0, Math.round(Number(auto.minSubtotalPence) || 0));
    if (subtotalP >= minP) {
      const pct = Math.max(0, Math.min(100, Number(auto.percent) || 0));
      discountP = Math.min(subtotalP, Math.round(subtotalP * (pct / 100)));
      discountLabel = auto.label;
    }
  }

  // Delivery fee. /api/order resolves it via resolveDelivery (outcode OR
  // radius mode) and passes it in opts.deliveryFeeP. Fall back to the outcode
  // lookup for any caller that doesn't pass it, so the function stays
  // self-contained.
  let deliveryFeeP = 0;
  if (fulfillment === 'delivery') {
    const passed = opts.deliveryFeeP;
    if (Number.isFinite(passed) && passed >= 0) {
      deliveryFeeP = passed;
    } else {
      // No (or invalid) fee passed in — fall back to the outcode lookup so a
      // NaN/negative override can never corrupt or undercut the total.
      const d = config.fulfillment.delivery;
      const p = normalisePostcode(input.deliveryAddress?.postcode);
      const byOutcode = d.feeByOutcode || {};
      const override = p && byOutcode[p.outcode];
      deliveryFeeP = Number.isFinite(override) ? override : d.feePence;
    }
  }

  // Per-order platform/service fee (kept by the platform operator). Counter sales
  // (the till) opt out via opts.suppressServiceFee — in-person sales don't carry
  // the service charge (card-terminal processing is absorbed instead). Web orders
  // still pay it.
  const serviceFeeP = opts.suppressServiceFee ? 0 : (config.serviceFeePence || 0);
  // Split the service charge so tickets/records show who gets what: serviceFeePlatformPence
  // is Lumin Labs' cut (taken as the Stripe application_fee); the rest stays with the shop.
  // Defaults to the whole fee → platform when unset (legacy behaviour).
  const serviceFeePlatformP = config.serviceFeePlatformPence != null
    ? Math.max(0, Math.min(serviceFeeP, Number(config.serviceFeePlatformPence) || 0))
    : serviceFeeP;
  const serviceFeeShopP = serviceFeeP - serviceFeePlatformP;

  // Minimum order check (applied to subtotal less discount).
  const netSubtotalP = subtotalP - discountP;
  if (fulfillment === 'delivery' && netSubtotalP < config.fulfillment.delivery.minimumOrderPence) {
    const minP = config.fulfillment.delivery.minimumOrderPence;
    const inclFees = !!config.fulfillment.delivery.minimumIncludesFees;
    const shownP = inclFees ? (minP + deliveryFeeP + serviceFeeP) : minP;
    return {
      ok: false,
      reason: inclFees
        ? `Minimum order £${(shownP / 100).toFixed(2)}.`
        : `Minimum delivery order is £${(shownP / 100).toFixed(2)}.`,
    };
  }

  const totalP = netSubtotalP + deliveryFeeP + serviceFeeP;
  if (totalP <= 0) {
    return { ok: false, reason: 'Cart is empty.' };
  }

  return {
    ok: true,
    lines,
    subtotalP,
    discountP,
    discountLabel,
    deliveryFeeP,
    serviceFeeP,
    serviceFeePlatformP,
    serviceFeeShopP,
    totalP,
    fulfillment,
  };
}

function indexMenu(menu) {
  const m = new Map();
  for (const cat of menu) {
    for (const item of cat.items || []) {
      m.set(item.id, item);
    }
  }
  return m;
}

// Set of item ids a single meal choice group may use: its category,
// optionally narrowed by an include or exclude id list. Mirrors the client
// UI so server validation matches exactly what the customer was offered.
function allowedMealChoiceIds(group, menu) {
  const allowed = new Set();
  const cat = menu.find(c => c.id === group.category);
  if (!cat) return allowed;
  const inc = Array.isArray(group.include) ? new Set(group.include) : null;
  const ex = Array.isArray(group.exclude) ? new Set(group.exclude) : null;
  for (const item of cat.items || []) {
    if (inc && !inc.has(item.id)) continue;
    if (ex && ex.has(item.id)) continue;
    allowed.add(item.id);
  }
  return allowed;
}
