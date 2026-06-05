/* GET /api/staff/orders — list orders (PIN-gated).
   ?view=done returns COMPLETED orders for a London-day range (?from=&to= or
   ?date=, default today), newest-first for the staff history view. Cancelled /
   voided orders are intentionally excluded — a cancel removes the order from the
   board (it stays in KV + the audit log for the record). The default (no view)
   returns the live kitchen queue. */
import { requireStaff } from '../../_lib/auth.js';
import { listActiveOrders, listOrdersBetween, resolveDayRange } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get('view') === 'done') {
    const { from, to } = resolveDayRange(url);
    const orders = (await listOrdersBetween(env, from, to)).filter(o => o.status === 'completed');
    return Response.json({ orders, from, to }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const orders = await listActiveOrders(env);
  return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
};
