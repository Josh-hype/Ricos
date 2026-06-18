/* POST /api/stripe-webhook — handles payment_intent.succeeded / failed.
   Backstop for the client-side confirm: markOrderPaid is idempotent, so if the
   thank-you page already promoted the order this is a no-op. */
import { verifyWebhook } from '../_lib/stripe.js';
import { getOrder, putOrder, markOrderPaid, paymentIntentMatchesOrder } from '../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');
  const event = await verifyWebhook(raw, sig, env);
  if (!event) return new Response('bad signature', { status: 400 });

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orderId = pi.metadata?.orderId;
    if (!orderId) return new Response('no order id', { status: 200 });
    const order = await getOrder(orderId, env);
    if (order && paymentIntentMatchesOrder(pi, order)) {
      // Pay-by-link orders are created from a Checkout Session, so the
      // PaymentIntent id isn't known until the customer pays. Record it (and the
      // connected account this event fired on) now so the order is refundable
      // later. No-op for web card orders — both are already set at creation.
      order.payment = order.payment || {};
      if (!order.payment.intentId) order.payment.intentId = pi.id;
      if (!order.payment.connectedAccountId && event.account) order.payment.connectedAccountId = event.account;
      await markOrderPaid(order, env);   // no-op if already promoted
    } else if (order) {
      console.warn('webhook: succeeded PI does not match order', orderId, pi.id);
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const orderId = pi.metadata?.orderId;
    if (orderId) {
      const order = await getOrder(orderId, env);
      if (order && order.status === 'pending_payment') {
        order.status = 'failed';
        order.payment.state = 'failed';
        order.history.push({ at: new Date().toISOString(), event: 'payment_failed' });
        await putOrder(order, env);
      }
    }
  }

  return new Response('ok', { status: 200 });
};
