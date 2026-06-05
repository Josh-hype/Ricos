/* GET /api/staff/summary — figures for a London-day range (PIN-gated).
   ?from=&to= or ?date= (default: today). Takings count every real order in the
   range; pending_payment (card never paid) and cancelled orders are excluded
   from the money but still surfaced as counts. Also returns a compact order log
   so the Z-report view can list every order in the range. */
import { requireStaff, requireManager } from '../../_lib/auth.js';
import { operatorsEnabled } from '../../_lib/operators.js';
import { requirePermission } from '../../_lib/permissions.js';
import { listOrdersBetween, resolveDayRange, refundedSoFar } from '../../_lib/kv.js';

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

  const isCard = (o) => o.paymentMethod === 'card' || o.paymentMethod === 'counter_card';
  const isUnpaid = (o) => (o.payment?.state === 'unpaid') || o.paymentMethod === 'unpaid';
  // Real orders that aren't cancelled / never-paid-online. `valid` carries the
  // money (paid only); unpaid "pay later" orders are live but count as £0 takings
  // until they're collected — so they're kept out of the financial sums.
  const live = orders.filter(o => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const valid = live.filter(o => !isUnpaid(o));
  const sum = (arr, f) => arr.reduce((a, o) => a + (f(o) || 0), 0);
  const grossP = sum(valid, o => o.totals?.totalP);
  // Per-order money attributed to each tender (handles split orders by their parts).
  const splitPartP = (o, tender) => (o.payment?.parts || [])
    .filter(p => p.tender === tender).reduce((a, p) => a + (p.amountP || 0), 0);
  const cashPartP = (o) => o.paymentMethod === 'split' ? splitPartP(o, 'cash') : (isCard(o) ? 0 : (o.totals?.totalP || 0));
  const cardPartP = (o) => o.paymentMethod === 'split' ? splitPartP(o, 'card') : (isCard(o) ? (o.totals?.totalP || 0) : 0);

  const summary = {
    from,
    to,
    orderCount: valid.length,
    grossP,
    avgP: valid.length ? Math.round(grossP / valid.length) : 0,
    serviceFeeP: sum(valid, o => o.totals?.serviceFeeP),
    deliveryFeeP: sum(valid, o => o.totals?.deliveryFeeP),
    // Refunds: sum the canonical per-order total (handles the refunds[] ledger
    // AND the legacy single-refund record) across every order in range —
    // including cancelled ones, since a cancellation auto-refunds.
    refundedP: sum(orders, o => refundedSoFar(o)),
    // A split order pays part cash + part card, so its money is attributed to each
    // method by its recorded parts (not lumped under one). Whole-tender orders put
    // their full total on the matching side.
    card: {
      count: valid.filter(o => isCard(o) || o.paymentMethod === 'split').length,
      grossP: sum(valid, cardPartP),
    },
    cash: {
      count: valid.filter(o => !isCard(o)).length, // includes splits — they carry a cash part
      grossP: sum(valid, cashPartP),
    },
    collection: valid.filter(o => o.fulfillment === 'collection').length,
    delivery: valid.filter(o => o.fulfillment === 'delivery').length,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    inProgress: live.filter(o => ['pending_accept', 'accepted', 'ready', 'out_for_delivery'].includes(o.status)).length,
    // Orders saved "pay later" and not yet collected — surfaced so the till can
    // show outstanding money without it polluting takings.
    unpaid: {
      count: live.filter(isUnpaid).length,
      grossP: sum(live.filter(isUnpaid), o => o.totals?.totalP),
    },
  };

  // Full orders (newest-first) so the Z report can show each one in detail.
  return Response.json({ summary, orders }, { headers: { 'Cache-Control': 'no-store' } });
};
