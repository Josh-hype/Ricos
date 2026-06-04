/* GET /api/staff/orders — list orders (PIN-gated).
   ?view=done returns finished orders (completed / cancelled) for a London-day
   range (?from=&to= or ?date=, default today), newest-first for the staff
   history view; the default returns the live kitchen queue. */
import { requireStaff } from '../../_lib/auth.js';
import { listActiveOrders, listOrdersBetween, resolveDayRange, DONE_STATUSES } from '../../_lib/kv.js';

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  // The 'recent' diagnostic can also be opened with ?key=<TILL_SETUP_PASSWORD>
  // (debug only) so it works from a KDS browser that has no staff cookie.
  const isRecent = url.searchParams.get('view') === 'recent';
  const keyOk = isRecent && env.TILL_SETUP_PASSWORD && (url.searchParams.get('key') || '') === env.TILL_SETUP_PASSWORD;
  if (!keyOk) {
    const denied = await requireStaff(request, env);
    if (denied) return denied;
  }
  if (isRecent) {
    // Diagnostic: today's orders (every status) with just the routing-relevant
    // fields, so we can see where an order is stuck. No customer PII.
    const { from, to } = resolveDayRange(url);
    const orders = (await listOrdersBetween(env, from, to)).slice(0, 25).map(o => ({
      id: o.id,
      status: o.status,
      source: o.source || null,
      paymentMethod: o.paymentMethod || null,
      paymentState: o.payment && o.payment.state || null,
      fulfillment: o.fulfillment || null,
      totalP: (o.totals && o.totals.totalP) ?? null,
      createdAt: o.createdAt,
    }));
    return Response.json({
      orders,
      webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET,
      stripeAccount: !!(env.STRIPE_SECRET_KEY),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.searchParams.get('view') === 'done') {
    const { from, to } = resolveDayRange(url);
    const orders = (await listOrdersBetween(env, from, to)).filter(o => DONE_STATUSES.has(o.status));
    return Response.json({ orders, from, to }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const orders = await listActiveOrders(env);
  return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
};
