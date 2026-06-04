/* GET /api/staff/kds/orders — the kitchen queue for a KDS device.
   Returns ACCEPTED orders (the ones "sent to the kitchen"), newest first so new
   orders appear at the front. Each order carries kdsStruck (the indices of line
   items already packed/struck) so the display restores ticks across refreshes.
   KDS-token only. */

import { requireKds } from '../../../_lib/auth.js';
import { listActiveOrders } from '../../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireKds(request, env);
  if (denied) return denied;

  const active = await listActiveOrders(env); // already newest-first
  const orders = active.filter(o => o.status === 'accepted');
  return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
};
