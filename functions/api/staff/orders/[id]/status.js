/* POST /api/staff/orders/:id/status — staff moves an order through
   ready / out_for_delivery / completed / cancelled. */
import { requireStaff } from '../../../../_lib/auth.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';

const ALLOWED = ['ready', 'out_for_delivery', 'completed', 'cancelled'];

export const onRequestPost = async ({ request, env, params }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const status = String(body.status || '');
  if (!ALLOWED.includes(status)) return j({ error: 'Invalid status.' }, 400);

  order.status = status;
  order.history.push({ at: new Date().toISOString(), event: status });
  await putOrder(order, env);

  return Response.json({ order });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
