/* GET /api/staff/summary — figures for a London-day range (PIN-gated).
   ?from=&to= or ?date= (default: today). Takings count every real order in the
   range; pending_payment (card never paid) and cancelled orders are excluded
   from the money but still surfaced as counts. Also returns a compact order log
   so the Z-report view can list every order in the range. */
import { requireStaff } from '../../_lib/auth.js';
import { listOrdersBetween, resolveDayRange } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const { from, to } = resolveDayRange(new URL(request.url));
  const orders = await listOrdersBetween(env, from, to);

  const isCard = (o) => o.paymentMethod === 'card';
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
    refundedP: sum(orders.filter(o => o.payment?.refund?.state === 'succeeded'), o => o.payment.refund.amountP),
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

  // Compact order log for the Z report (already newest-first).
  const log = orders.map(o => ({
    id: o.id,
    createdAt: o.createdAt,
    status: o.status,
    paymentMethod: o.paymentMethod,
    fulfillment: o.fulfillment,
    totalP: o.totals?.totalP || 0,
    refunded: o.payment?.refund?.state === 'succeeded',
  }));

  return Response.json({ summary, orders: log }, { headers: { 'Cache-Control': 'no-store' } });
};
