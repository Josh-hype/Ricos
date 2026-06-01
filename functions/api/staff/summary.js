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
  const valid = orders.filter(o => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const sum = (arr, f) => arr.reduce((a, o) => a + (f(o) || 0), 0);
  const grossP = sum(valid, o => o.totals?.totalP);

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
    card: {
      count: valid.filter(isCard).length,
      grossP: sum(valid.filter(isCard), o => o.totals?.totalP),
    },
    cash: {
      count: valid.filter(o => !isCard(o)).length,
      grossP: sum(valid.filter(o => !isCard(o)), o => o.totals?.totalP),
    },
    collection: valid.filter(o => o.fulfillment === 'collection').length,
    delivery: valid.filter(o => o.fulfillment === 'delivery').length,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    inProgress: valid.filter(o => ['pending_accept', 'accepted', 'ready', 'out_for_delivery'].includes(o.status)).length,
  };

  // Full orders (newest-first) so the Z report can show each one in detail.
  return Response.json({ summary, orders }, { headers: { 'Cache-Control': 'no-store' } });
};
