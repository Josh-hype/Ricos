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
      spice: typeof line.spice === 'string' ? line.spice.slice(0, 40) : null,
      modifiers: modSummaries,
      mealChoices: mealChoiceNames,
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
