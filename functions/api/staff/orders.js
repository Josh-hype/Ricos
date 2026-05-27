/* GET /api/staff/orders — list orders (PIN-gated).
   ?view=done returns finished orders (completed / cancelled) newest-first for
   the staff history view; the default returns the live kitchen queue. */
import { requireStaff } from '../../_lib/auth.js';
import { listActiveOrders, listDoneOrders } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const view = new URL(request.url).searchParams.get('view');
  const orders = view === 'done'
    ? await listDoneOrders(env)
    : await listActiveOrders(env);
  return Response.json({ orders }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
