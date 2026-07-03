/* Lumin Labs revenue model — processor-AWARE, but processor-INDEPENDENT where
   it counts.

   Lumin Labs earns two things, NEITHER of which depends on who processes the card:
     1. Subscription   — a flat weekly fee per live shop (£35/wk today).
     2. Per-order fee  — a fixed platform margin per order, taken as the Stripe
                         Connect application_fee: 50p on each ONLINE order, 10p on
                         each IN-PERSON card payment through the till.

   The CARD-PROCESSING COST (the % + fixed the acquirer keeps) is a SEPARATE line
   and it's the one in flux: online card is on Stripe today (~1.5% + 20p) and is
   moving to Elavon/MWBS at better rates. So the processor is modelled as DATA
   (registry.processors) and never hard-coded here — swap a shop's onlineProcessor
   and the cost line re-prices itself while Lumin Labs' own revenue is untouched.

   This module is deliberately pure (no I/O): the admin endpoints feed it figures
   pulled from Stripe (or, after a processor migration, from another source) and
   it returns the numbers the dashboard shows. */

import { getProcessorRates, perOrderFeeP, perOrderFeeInPersonP, subscriptionWeeklyP } from './registry.js';

// Estimate the acquirer's processing fee on ONE charge, in pence.
// channel: 'online' (web card / pay-by-link) or 'inPerson' (Terminal reader).
export function processingFeeP(amountP, processorKey, channel = 'online') {
  const { percent, fixedP } = getProcessorRates(processorKey, channel);
  if (!(amountP > 0)) return 0;
  return Math.round(amountP * percent / 100) + fixedP;
}

// Acquirer cost across a whole channel: percent applies to the gross, but the
// FIXED fee is per-TRANSACTION — so it scales with the order count, not the
// aggregate. channels: { online:{grossP,count}, inPerson:{grossP,count} }.
export function processingCostP(channels, processorKey) {
  const on = getProcessorRates(processorKey, 'online');
  const ip = getProcessorRates(processorKey, 'inPerson');
  const o = channels.online || { grossP: 0, count: 0 };
  const n = channels.inPerson || { grossP: 0, count: 0 };
  return Math.round((o.grossP || 0) * on.percent / 100) + on.fixedP * (o.count || 0)
       + Math.round((n.grossP || 0) * ip.percent / 100) + ip.fixedP * (n.count || 0);
}

// Whole-number weeks-ish elapsed across an inclusive day range, as a fraction,
// for accruing the weekly subscription over an arbitrary window (e.g. a month
// shows ~4.3 weeks). Days are inclusive, so a single day = 1/7 of a week.
export function weeksInRange(fromYmd, toYmd) {
  const from = new Date(fromYmd + 'T00:00:00Z');
  const to = new Date(toYmd + 'T00:00:00Z');
  const days = Math.round((to - from) / 86400000) + 1; // inclusive
  return Math.max(days, 1) / 7;
}

/* Roll the per-shop facts into the figures the dashboard renders.

   Each `shopStat` is:
     { shop, orderCount, grossP, applicationFeesP, channelSplit }
   where channelSplit is { online: {count, grossP}, inPerson: {count, grossP} }
   (inPerson optional — most shops are online-only on the platform today).

   Returns a per-shop breakdown plus a platform-wide total. Money is all pence. */
export function rollUp(shopStats, { fromYmd, toYmd } = {}) {
  const weeks = (fromYmd && toYmd) ? weeksInRange(fromYmd, toYmd) : 0;

  const shops = shopStats.map((s) => {
    const shop = s.shop || {};
    const orderCount = Number(s.orderCount) || 0;
    const grossP = Number(s.grossP) || 0;
    const online = s.channelSplit?.online || { count: orderCount, grossP };
    const inPerson = s.channelSplit?.inPerson || { count: 0, grossP: 0 };

    // Card-processing COST (whose? the venue's, on Stripe direct charges) —
    // priced from the shop's CURRENT processor, fixed fee per transaction. The
    // seam that re-prices itself when a shop moves online card to Elavon.
    const procKey = shop.onlineProcessor || 'stripe';
    const processingP = processingCostP({ online, inPerson }, procKey);

    // Lumin Labs PER-ORDER revenue, two readings:
    //   expectedP  = what the configured margins say Lumin Labs is owed, priced
    //                PER CHANNEL — 50p per online order + 10p per in-person card
    //                payment (mirroring the application_fee checkout and the till
    //                actually charge). Processor-independent.
    //   collectedP = what Stripe actually retained as application_fees in range.
    // They track each other while everything's on Stripe; once online card moves
    // to Elavon (no Stripe application_fee on those orders) `collected` drops
    // below `expected`, and the gap is what Lumin Labs must invoice another way.
    const feeP = perOrderFeeP(shop);
    const feeInPersonP = perOrderFeeInPersonP(shop);
    const perOrderExpectedP = feeP * (online.count || 0) + feeInPersonP * (inPerson.count || 0);
    const perOrderCollectedP = Number(s.applicationFeesP) || 0;

    // Subscription accrues ONLY while the shop is actively subscribed (paying).
    // A shop can be operating + earning Lumin per-order fees yet NOT on the weekly
    // fee yet (onboarding, or — like Food Station — held until a condition is met).
    // So `live` (operating, takes orders) and `subscribed` (paying the weekly fee)
    // are independent: the per-order fees above are earned on every order either
    // way; only the subscription line waits for `status: "active"`.
    const subStatus = shop.subscription?.status || (shop.live ? 'active' : 'pending');
    const subscribed = subStatus === 'active';
    const subWeeklyP = subscriptionWeeklyP(shop);
    // Accrue only from the shop's own billing start (`subscription.since`), so a
    // wide window ("All time") never invents revenue from before the shop was
    // billing. YMD strings compare correctly as plain strings.
    const sinceYmd = shop.subscription?.since || null;
    let accrualWeeks = weeks;
    if (sinceYmd && fromYmd && toYmd) {
      const start = sinceYmd > fromYmd ? sinceYmd : fromYmd;
      accrualWeeks = start > toYmd ? 0 : weeksInRange(start, toYmd);
    }
    const subscriptionAccruedP = subscribed ? Math.round(subWeeklyP * accrualWeeks) : 0;

    return {
      slug: shop.slug,
      name: shop.name,
      city: shop.city || '',
      live: !!shop.live,
      subscribed,
      subscriptionStatus: subStatus,
      pending: !/^acct_/.test(String(shop.connectedAccountId || '')),
      processor: getProcessorRates(procKey, 'online').label,
      orderCount,
      grossP,
      processingP,
      perOrderFeeP: feeP,
      perOrderFeeInPersonP: feeInPersonP,
      perOrderExpectedP,
      perOrderCollectedP,
      subscriptionWeeklyP: subWeeklyP,
      subscriptionAccruedP,
      // Lumin Labs revenue FROM THIS SHOP in the window: subscription accrued +
      // per-order fees actually collected via the processor.
      luminRevenueP: subscriptionAccruedP + perOrderCollectedP,
      // Diagnostics (so a silently-zero shop is explainable, not a mystery).
      feeCount: Number(s.feeCount) || 0,
      chargeCount: s.chargeCount == null ? null : Number(s.chargeCount),
      volumeError: s.volumeError || null,
    };
  });

  const sum = (f) => shops.reduce((a, s) => a + (f(s) || 0), 0);
  const liveShops = shops.filter(s => s.live).length;          // operating (taking orders)
  const payingShops = shops.filter(s => s.subscribed).length;  // actively on the weekly fee
  const totals = {
    shops: shops.length,
    liveShops,
    payingShops,
    orderCount: sum(s => s.orderCount),
    grossP: sum(s => s.grossP),
    processingP: sum(s => s.processingP),
    perOrderExpectedP: sum(s => s.perOrderExpectedP),
    perOrderCollectedP: sum(s => s.perOrderCollectedP),
    subscriptionAccruedP: sum(s => s.subscriptionAccruedP),
    // Current weekly subscription run-rate across PAYING shops (a forward figure,
    // independent of the selected window).
    subscriptionWeeklyRunRateP: shops.filter(s => s.subscribed).reduce((a, s) => a + s.subscriptionWeeklyP, 0),
    luminRevenueP: sum(s => s.luminRevenueP),
  };

  return { shops, totals, weeks };
}
