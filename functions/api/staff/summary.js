/* GET /api/staff/summary — figures for a London-day range (PIN-gated).
   ?from=&to= or ?date= (default: today). Takings count every real order in the
   range; pending_payment (card never paid) and cancelled orders are excluded
   from the money but still surfaced as counts. Also returns a compact order log
   so the Z-report view can list every order in the range. */
import { requireStaff, requireManager } from '../../_lib/auth.js';
import { listOrdersBetween, resolveDayRange } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  // Financial views are manager-gated when MANAGER_PIN_HASH is configured.
  // Shops that haven't set one keep the old behaviour (any staff can view).
  const mgrDenied = await requireManager(request, env);
  if (mgrDenied) return mgrDenied;

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

  // Full orders (newest-first) so the Z report can show each one in detail.
  return Response.json({ summary, orders }, { headers: { 'Cache-Control': 'no-store' } });
};
