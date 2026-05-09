/* Server-side total calculation. The frontend is NEVER trusted for prices.
   It sends item ids + quantities + modifier ids; we look up the canonical
   price from the menu and compute totals here. */

import { getMenu } from './menu.js';

export function computeTotals(input, config) {
  const menu = getMenu();
  const itemsById = indexMenu(menu);
  const lines = [];
  let subtotalP = 0;

  for (const line of input.items || []) {
    const item = itemsById.get(line.id);
    if (!item) {
      return { ok: false, reason: `Unknown item: ${line.id}` };
    }
    const qty = Math.max(1, Math.min(20, Number(line.qty) || 1));
    let lineP = item.priceP;

    if (line.meal && item.mealAddP != null) lineP += item.mealAddP;

    // Modifiers (size, sauce, etc.) — each modifier contributes priceDeltaP.
    const modIds = Array.isArray(line.modifiers) ? line.modifiers : [];
    const modSummaries = [];
    for (const modId of modIds) {
      const mod = item.modifiers?.find(x => x.id === modId);
      if (!mod) continue; // ignore unknown modifiers silently
      lineP += mod.priceDeltaP || 0;
      modSummaries.push(mod.label);
    }

    const lineTotalP = lineP * qty;
    subtotalP += lineTotalP;

    lines.push({
      id: item.id,
      name: item.name,
      qty,
      meal: !!line.meal,
      modifiers: modSummaries,
      unitPriceP: lineP,
      lineTotalP,
    });
  }

  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'collection';

  // Promo: 10% off online subtotal.
  let discountP = 0;
  let discountLabel = null;
  if (config.promo?.autoOnlineDiscount?.enabled) {
    const pct = config.promo.autoOnlineDiscount.percent;
    discountP = Math.round(subtotalP * (pct / 100));
    discountLabel = config.promo.autoOnlineDiscount.label;
  }

  // Delivery fee.
  let deliveryFeeP = 0;
  if (fulfillment === 'delivery') {
    deliveryFeeP = config.fulfillment.delivery.feePence;
  }

  // Per-order platform/service fee (kept by the platform operator).
  const serviceFeeP = config.serviceFeePence || 0;

  // Minimum order check (applied to subtotal less discount).
  const netSubtotalP = subtotalP - discountP;
  if (fulfillment === 'delivery' && netSubtotalP < config.fulfillment.delivery.minimumOrderPence) {
    return {
      ok: false,
      reason: `Minimum delivery order is £${(config.fulfillment.delivery.minimumOrderPence / 100).toFixed(2)}.`,
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
