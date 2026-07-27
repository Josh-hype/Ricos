/* GET /api/staff/summary — figures for a London-day range (PIN-gated).
   ?from=&to= or ?date= (default: today). Takings count every real order in the
   range; pending_payment (card never paid) and cancelled orders are excluded
   from the money but still surfaced as counts. Also returns a compact order log
   so the Z-report view can list every order in the range. */
import { requireStaff, requireManager } from '../../_lib/auth.js';
import { operatorsEnabled } from '../../_lib/operators.js';
import { requirePermission } from '../../_lib/permissions.js';
import { listOrdersBetween, resolveDayRange, refundedSoFar } from '../../_lib/kv.js';
import { getConfig } from '../../_lib/config.js';
import { cardFeeP } from '../../_lib/counter-totals.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  // Financial views: per-operator mode requires the reports.view permission;
  // otherwise fall back to the manager-PIN gate (unchanged for legacy shops).
  if (await operatorsEnabled(env)) {
    const pd = await requirePermission(request, env, 'reports.view');
    if (pd) return pd;
  } else {
    const mgrDenied = await requireManager(request, env);
    if (mgrDenied) return mgrDenied;
  }

  const { from, to } = resolveDayRange(new URL(request.url));
  const orders = await listOrdersBetween(env, from, to);

  const config = getConfig();
  const isCard = (o) => o.paymentMethod === 'card' || o.paymentMethod === 'counter_card';
  // Money still owed — NOT takings. The same rule the till uses, so the report
  // matches the board: a saved-unpaid "pay later", a part-paid split, or an online
  // cash-on-collection/delivery order ('cash_due') that hasn't been settled yet.
  const owesMoney = (o) => {
    const st = o.payment?.state;
    return st === 'unpaid' || st === 'part_paid' || st === 'cash_due' || o.paymentMethod === 'unpaid';
  };
  const totalOf = (o) => o.totals?.totalP || 0;
  const refundOf = (o) => refundedSoFar(o) || 0;
  const fullyRefunded = (o) => totalOf(o) > 0 && refundOf(o) >= totalOf(o);

  // live   = real orders (not cancelled, not an abandoned online card).
  // paid   = the money is actually in (everything owesMoney() covers is excluded).
  // takings = paid sales that weren't fully refunded — these carry the day's money
  //           and the card/cash counts. A fully-refunded order nets to £0 and drops
  //           out of the counts (its refund still shows on the refunds line).
  // Genuinely PAID = the money was actually collected. A strict whitelist on
  // payment.state so nothing else can leak into takings: this excludes cash_due
  // (online cash not settled), unpaid / part_paid (pay-later / half-collected
  // split), 'awaiting' (card never completed) and — the leak we just hit —
  // 'failed' (card declined; the order sits at status 'failed'). Refund states
  // WERE paid, so they stay in and net off below.
  const isPaidState = (o) => {
    const st = o.payment?.state;
    return st === 'paid' || st === 'partly_refunded' || st === 'refunded';
  };
  // live = still-active orders (drives the in-progress + outstanding counts).
  const live = orders.filter(o => o.status !== 'pending_payment' && o.status !== 'cancelled');
  // paid = takings base — collected money only, and never a cancelled order.
  const paid = orders.filter(o => o.status !== 'cancelled' && isPaidState(o));
  const takings = paid.filter(o => !fullyRefunded(o));
  const sum = (arr, f) => arr.reduce((a, o) => a + (f(o) || 0), 0);

  // Per-tender money. Refunds are only ever taken on card orders (see refund.js),
  // so they come off the card side; a split order is attributed by its parts.
  const splitPartP = (o, tender) => (o.payment?.parts || [])
    .filter(p => p.tender === tender).reduce((a, p) => a + (p.amountP || 0), 0);
  const cardBaseP = (o) => o.paymentMethod === 'split' ? splitPartP(o, 'card') : (isCard(o) ? totalOf(o) : 0);
  const cashBaseP = (o) => o.paymentMethod === 'split' ? splitPartP(o, 'cash') : (isCard(o) ? 0 : totalOf(o));
  const cardNetP = (o) => Math.max(0, cardBaseP(o) - refundOf(o));
  const cashNetP = (o) => cashBaseP(o);

  // Lumin Labs fee — the platform application_fee ACTUALLY collected via Stripe:
  //   online card → the service-charge platform share (serviceFeePlatformP, 50p)
  //   counter card on a LumiPOS reader → the per-card margin (cardFeeP)
  //   external-machine card / cash → £0 here (no Stripe charge; the cash service-
  //     charge share is reconciled with the venue off-book). intentId ⇒ via Stripe.
  const platformFeeOf = (o) => {
    if (!o.payment?.intentId) return 0;
    if (o.paymentMethod === 'counter_card') return cardFeeP(totalOf(o), config);
    if (o.paymentMethod === 'split') return cardFeeP(splitPartP(o, 'card'), config);
    // online card — the service-charge platform share. New orders carry
    // serviceFeePlatformP (the 50p split); orders from BEFORE the split deploy took
    // the WHOLE service fee as the application_fee, so fall back to serviceFeeP for
    // those (else they'd wrongly read £0 and undercount the day's Lumin Labs fee).
    return o.totals?.serviceFeePlatformP != null ? o.totals.serviceFeePlatformP : (o.totals?.serviceFeeP || 0);
  };
  // Stripe processing fee — an ESTIMATE on Stripe-charged orders (on direct charges
  // the venue pays this). Card-PRESENT sales taken on a LumiPOS reader (counter card,
  // and the card part of a split) are charged Stripe's cheaper in-person rate; online
  // web card and pay-by-link (card-NOT-present) take the online rate. Defaults match UK
  // Stripe pricing — online 1.5% + 20p, in-person 1.4% + 10p — and are overridable per
  // shop via config.stripe.feePercent/feeFixedPence (online) and
  // config.stripe.terminalFeePercent/terminalFeeFixedPence (in person). Exact figures
  // live in Stripe.
  const onPct = Number(config.stripe?.feePercent ?? 1.5);
  const onFixedP = Math.round(Number(config.stripe?.feeFixedPence ?? 20));
  const tpPct = Number(config.stripe?.terminalFeePercent ?? 1.4);
  const tpFixedP = Math.round(Number(config.stripe?.terminalFeeFixedPence ?? 10));
  const stripeFeeOf = (o) => {
    if (!o.payment?.intentId) return 0;          // cash / external machine — no Stripe charge
    if (o.paymentMethod === 'counter_card')      // in person on a LumiPOS reader (card present)
      return Math.round(totalOf(o) * tpPct / 100) + tpFixedP;
    if (o.paymentMethod === 'split')             // only the card part runs on the reader
      return Math.round(splitPartP(o, 'card') * tpPct / 100) + tpFixedP;
    return Math.round(totalOf(o) * onPct / 100) + onFixedP;  // online web card + pay-by-link
  };

  const cardGrossP = sum(takings, cardNetP);
  const cashGrossP = sum(takings, cashNetP);
  const grossP = cardGrossP + cashGrossP;

  // Dine-in split (hospitality shops). Counted here so `otherSales` below can be
  // derived as the exact remainder of takings.
  const eatInCount = takings.filter(o => /^(counter|link)-eatin$/.test(o.source || '')).length;
  const takeawayCount = takings.filter(o => /^(counter|link)-takeaway$/.test(o.source || '')).length;

  const summary = {
    from,
    to,
    orderCount: takings.length,
    grossP,
    avgP: takings.length ? Math.round(grossP / takings.length) : 0,
    // Platform (Lumin Labs) revenue and the venue's Stripe cost, kept separate.
    platformFeeP: sum(takings, platformFeeOf),
    stripeFeeP: sum(takings, stripeFeeOf),
    // Total service charge the customer paid (info; the split is platform + venue).
    serviceFeeP: sum(takings, o => o.totals?.serviceFeeP),
    deliveryFeeP: sum(takings, o => o.totals?.deliveryFeeP),
    // Refunds: canonical per-order total across every order in range — including
    // cancelled ones (a cancellation auto-refunds) and partial refunds on takings.
    refundedP: sum(orders, refundOf),
    // A split order carries both a cash and a card part, so it's counted on each
    // side and its money attributed by its recorded parts (net of any refund).
    card: {
      count: takings.filter(o => isCard(o) || o.paymentMethod === 'split').length,
      grossP: cardGrossP,
    },
    cash: {
      count: takings.filter(o => !isCard(o)).length, // includes splits — they carry a cash part
      grossP: cashGrossP,
    },
    collection: takings.filter(o => o.fulfillment === 'collection').length,
    delivery: takings.filter(o => o.fulfillment === 'delivery').length,
    // Hospitality split (coffee shops / restaurants). Eat-in and takeaway sales
    // both carry fulfillment 'collection', so the two counts above can't tell them
    // apart — a dine-in venue would otherwise see its whole day filed under
    // "Collection". Derived from the sale mode in o.source; ADDITIVE, so the
    // existing collection/delivery figures are untouched and a takeaway shop
    // (which never produces these sources) reports 0 for both, exactly as before.
    eatIn: eatInCount,
    takeaway: takeawayCount,
    // Everything else in the day's takings (delivery, online, quick-charge, a
    // legacy walk-in). Present so the dine-in split is EXHAUSTIVE: eatIn +
    // takeaway + otherSales === orderCount, and a Z report whose rows don't add
    // up to the order count is worse than no split at all.
    otherSales: takings.length - eatInCount - takeawayCount,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    inProgress: live.filter(o => ['pending_accept', 'accepted', 'ready', 'out_for_delivery'].includes(o.status)).length,
    // Money still owed (pay-later + unsettled online cash) — surfaced so the till
    // shows outstanding cash without it polluting takings.
    unpaid: {
      count: live.filter(owesMoney).length,
      grossP: sum(live.filter(owesMoney), totalOf),
    },
  };

  // Full orders (newest-first) so the Z report can show each one in detail.
  return Response.json({ summary, orders }, { headers: { 'Cache-Control': 'no-store' } });
};
