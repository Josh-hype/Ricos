/* GET /api/staff/summary — today's figures (PIN-gated).
   "Today" is the shop's London calendar day. Takings count every real order
   placed today; pending_payment (card never paid) and cancelled orders are
   excluded from the money totals but still surfaced as counts. */
import { requireStaff } from '../../_lib/auth.js';
import { listOrdersOnDay, londonDay } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const date = londonDay();
  const orders = await listOrdersOnDay(env, date);

  const isCard = (o) => o.paymentMethod === 'card';
  const valid = orders.filter(o => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const sum = (arr, f) => arr.reduce((a, o) => a + (f(o) || 0), 0);
  const grossP = sum(valid, o => o.totals?.totalP);

  const summary = {
    date,
    orderCount: valid.length,
    grossP,
    avgP: valid.length ? Math.round(grossP / valid.length) : 0,
    serviceFeeP: sum(valid, o => o.totals?.serviceFeeP),
    deliveryFeeP: sum(valid, o => o.totals?.deliveryFeeP),
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

  return Response.json({ summary }, { headers: { 'Cache-Control': 'no-store' } });
};
