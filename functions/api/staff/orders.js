/* GET /api/staff/orders — list orders (PIN-gated).
   ?view=done returns finished orders (completed / cancelled) for a London-day
   range (?from=&to= or ?date=, default today), newest-first for the staff
   history view; the default returns the live kitchen queue. */
import { requireStaff } from '../../_lib/auth.js';
import { listActiveOrders, listOrdersBetween, resolveDayRange, DONE_STATUSES } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get('view') === 'done') {
    const { from, to } = resolveDayRange(url);
    const orders = (await listOrdersBetween(env, from, to)).filter(o => DONE_STATUSES.has(o.status));
    return Response.json({ orders, from, to }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const orders = await listActiveOrders(env);
  return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
};
