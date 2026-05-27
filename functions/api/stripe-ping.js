/* TEMP DEBUG (go-live): isolate the live Stripe PaymentIntent call.
   GET /api/stripe-ping?ping=1 — runs the exact direct-charge PI creation the
   order flow uses (on the connected account, with the application fee) and
   returns the result or the full Stripe error. Delete once payments work. */
import { getConfig } from '../_lib/config.js';
import { createPaymentIntent } from '../_lib/stripe.js';

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('ping') !== '1') {
    return Response.json({ ok: false, hint: 'add ?ping=1' });
  }
  const config = getConfig();
  const info = {
    hasSecretKey: !!env.STRIPE_SECRET_KEY,
    secretKeyPrefix: (env.STRIPE_SECRET_KEY || '').slice(0, 8),
    connectedAccountId: config.stripe?.connectedAccountId || null,
  };
  try {
    const pi = await createPaymentIntent({
      amountP: 100,
      currency: 'gbp',
      orderId: 'ping-' + Date.now(),
      connectedAccountId: config.stripe?.connectedAccountId,
      applicationFeeP: 50,
    }, env);
    return Response.json({ ok: true, piId: pi.id, status: pi.status, info });
  } catch (e) {
    return Response.json({
      ok: false,
      error: e && e.message ? e.message : String(e),
      stripe: e && e.stripe ? e.stripe : null,
      info,
    });
  }
};
