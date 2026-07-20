/* POST /api/order/:id/push — attach the customer app's push device token to an
   already-placed order. Body: { t: <statusToken>, token, platform }.

   Why after the fact: the app asks for notification permission on the
   thank-you screen (after the first successful order — the moment the value
   is obvious), so the token for THAT order can only arrive once the order
   exists. Later orders skip this: the shim injects the cached token into the
   POST /api/order body directly.

   Auth is the same statusToken capability as GET /api/order/:id/status, so
   only the customer who placed the order can point its notifications at a
   device. Transactional-only — this is not a marketing opt-in.

   The token is stored under its OWN key (push:<orderId>), NOT by rewriting
   the order record: KV is eventually consistent, so a get→mutate→put of the
   whole order here could race a staff transition (accept/cancel on the till)
   and write a stale copy back — silently un-accepting an order, or reviving
   a cancelled one whose refund was already issued. A side key can't touch
   order state. sendOrderPush (functions/_lib/push.js) reads it as the
   fallback when the order record carries no inline token. */

import { verifyOrderStatusToken } from '../../../_lib/order-token.js';
import { getOrder } from '../../../_lib/kv.js';
import { rateLimit } from '../../../_lib/rate-limit.js';

const SIDE_KEY_TTL_S = 48 * 3600; // matches the statusToken lifetime

export const onRequestPost = async ({ request, env, params }) => {
  const limited = await rateLimit(env, 'order-push', request, 20);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const id = String(params.id || '').toUpperCase();
  if (!(await verifyOrderStatusToken(body.t, id, env))) {
    return j({ error: 'Not authorised.' }, 401);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > 512) return j({ error: 'Invalid device token.' }, 400);

  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  // Pointless on a finished order — accept silently (the app doesn't care)
  // but skip the write. Read-only check: a stale read here can at worst store
  // a token for an order that just finished, which sends nothing.
  if (['pending_payment', 'pending_accept', 'accepted', 'ready', 'out_for_delivery'].includes(order.status)) {
    await env.ORDERS_KV.put(`push:${id}`, JSON.stringify({
      token,
      platform: body.platform === 'ios' ? 'ios' : 'android',
    }), { expirationTtl: SIDE_KEY_TTL_S });
  }
  return Response.json({ ok: true });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
