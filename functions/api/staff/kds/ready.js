/* POST /api/staff/kds/ready { id } — the kitchen "bumps" an order from the KDS.
   Moves it accepted → ready (food's done); front-of-house completes / hands it
   over on the till. KDS-token only. Idempotent: only an accepted order moves. */

import { requireKds } from '../../../_lib/auth.js';
import { getOrder, putOrder } from '../../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireKds(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const id = String(body.id || '').toUpperCase();
  if (!id) return j({ error: 'Missing order id.' }, 400);

  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);
  if (order.status !== 'accepted') return j({ ok: true, order }); // already moved on — no-op

  const at = new Date().toISOString();
  order.status = 'ready';
  order.history = order.history || [];
  order.history.push({ at, event: 'ready', by: 'KDS' });
  await putOrder(order, env);
  return j({ ok: true, order });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
