/* GET /api/staff/orders — list active orders (PIN-gated). */
import { requireStaff } from '../../_lib/auth.js';
import { listActiveOrders } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const orders = await listActiveOrders(env);
  return Response.json({ orders }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
