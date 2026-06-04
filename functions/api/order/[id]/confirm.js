/* POST /api/order/:id/confirm — promote a just-paid card order to the kitchen
   queue immediately, without waiting for the Stripe webhook.

   The thank-you page calls this the moment payment succeeds. We verify the
   PaymentIntent really succeeded server-side (on the connected account) before
   promoting, so it can't be spoofed by a crafted request. Idempotent and safe
   to call repeatedly; the webhook stays as the backstop. */
import { getConfig } from '../../../_lib/config.js';
import { getOrder, markOrderPaid, paymentIntentMatchesOrder } from '../../../_lib/kv.js';
import { retrievePaymentIntent } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ env, params }) => {
  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'not found' }, 404);
  const orderNumber = order.orderNumber || null; // short memorable number for the customer

  // Cash orders (and already-promoted card orders) need nothing here.
  if (order.status !== 'pending_payment') return j({ status: order.status, orderNumber });

  const intentId = order.payment?.intentId;
  if (!intentId) return j({ status: order.status, orderNumber });
  const acct = order.payment?.connectedAccountId || getConfig().stripe?.connectedAccountId;

  try {
    const pi = await retrievePaymentIntent(intentId, acct, env);
    if (pi?.status === 'succeeded' && paymentIntentMatchesOrder(pi, order)) {
      await markOrderPaid(order, env);
      return j({ status: 'pending_accept', orderNumber });
    }
    return j({ status: order.status, orderNumber, piStatus: pi?.status || null });
  } catch (e) {
    // Non-fatal — the Stripe webhook will still promote it shortly.
    console.warn('confirm: PI retrieve failed', e);
    return j({ status: order.status, orderNumber, error: 'verify_failed' });
  }
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
