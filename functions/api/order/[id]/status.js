/* GET /api/order/:id/status?t=<statusToken> — customer-facing order tracking.

   Auth is the statusToken minted by POST /api/order (a 48-hour HMAC
   capability bound to this order id), so the customer who placed the order —
   and only them — can poll it without an account. Used by the thank-you page
   in the customer app to render the live status timeline.

   Deliberately returns NO personal data: just the lifecycle state. */

import { verifyOrderStatusToken } from '../../../_lib/order-token.js';
import { getOrder } from '../../../_lib/kv.js';
import { rateLimit } from '../../../_lib/rate-limit.js';

export const onRequestGet = async ({ request, env, params }) => {
  // Generous: the tracking screen polls every 30s (≈20/window) and households
  // can share an IP — 120/fixed-10-min-window keeps several concurrent
  // trackers clear of the cap while still damping token brute-force.
  const limited = await rateLimit(env, 'order-status', request, 120);
  if (limited) return limited;

  const id = String(params.id || '').toUpperCase();
  const url = new URL(request.url);
  if (!(await verifyOrderStatusToken(url.searchParams.get('t'), id, env))) {
    return j({ error: 'Not authorised.' }, 401);
  }

  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  const last = order.history?.[order.history.length - 1];
  return new Response(JSON.stringify({
    ok: true,
    status: order.status,
    fulfillment: order.fulfillment,
    orderNumber: order.orderNumber ?? null,
    schedule: order.schedule || null,
    readyAt: order.readyAt || null,
    placedAt: order.createdAt || null,
    updatedAt: last?.at || order.createdAt || null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
