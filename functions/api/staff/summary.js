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
  const live = orders.filter(o => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const paid = live.filter(o => !owesMoney(o));
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
    return o.totals?.serviceFeePlatformP || 0; // online card
  };
  // Stripe processing fee — an ESTIMATE on Stripe-charged orders (on direct charges
  // the venue pays this). Default UK rate 1.5% + 20p; override per shop with
  // config.stripe.feePercent / feeFixedPence. Exact figures live in Stripe.
  const feePct = Number(config.stripe?.feePercent ?? 1.5);
  const feeFixedP = Math.round(Number(config.stripe?.feeFixedPence ?? 20));
  const stripeFeeOf = (o) => o.payment?.intentId ? Math.round(totalOf(o) * feePct / 100) + feeFixedP : 0;

  const cardGrossP = sum(takings, cardNetP);
  const cashGrossP = sum(takings, cashNetP);
  const grossP = cardGrossP + cashGrossP;

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
