/* POST /api/staff/kds/items { id, index, struck } — tick/untick a single line
   item on the KDS as it's packed. Persisted on the order (order.kdsStruck), so
   the strike survives the next poll and shows on every screen. KDS-token only. */

import { requireKds } from '../../../_lib/auth.js';
import { getOrder, putOrder } from '../../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireKds(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const id = String(body.id || '').toUpperCase();
  const index = Number(body.index);
  const struck = !!body.struck;
  if (!id) return j({ error: 'Missing order id.' }, 400);

  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);
  const n = (order.totals && order.totals.lines && order.totals.lines.length) || 0;
  if (!Number.isInteger(index) || index < 0 || index >= n) return j({ error: 'Bad item index.' }, 400);

  const set = new Set(order.kdsStruck || []);
  if (struck) set.add(index); else set.delete(index);
  order.kdsStruck = [...set].sort((a, b) => a - b);
  await putOrder(order, env);
  return j({ ok: true, kdsStruck: order.kdsStruck });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
