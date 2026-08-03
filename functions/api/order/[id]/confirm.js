/* POST /api/order/:id/confirm — promote a just-paid card order to the kitchen
   queue immediately, without waiting for the Stripe webhook.

   The thank-you page calls this the moment payment succeeds. We verify the
   PaymentIntent really succeeded server-side (on the connected account) before
   promoting, so it can't be spoofed by a crafted request. Idempotent and safe
   to call repeatedly; the webhook stays as the backstop. */
import { getConfig } from '../../../_lib/config.js';
import { getOrder, markOrderPaid, paymentIntentMatchesOrder } from '../../../_lib/kv.js';
import { retrievePaymentIntent, retrieveCheckoutSession } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ env, params }) => {
  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'not found' }, 404);
  const orderNumber = order.orderNumber || null; // short memorable number for the customer
  // Order value in pence, echoed back so the thank-you page can report a real
  // Purchase value to the Meta Pixel for ad-conversion tracking. Non-sensitive.
  const totalP = order.totals?.totalP ?? null;

  // Cash orders (and already-promoted card orders) need nothing here.
  if (order.status !== 'pending_payment') return j({ status: order.status, orderNumber, totalP });

  const acct = order.payment?.connectedAccountId || getConfig().stripe?.connectedAccountId;

  // A pay-by-link order is created from a Checkout Session and has NO
  // paymentIntentId until the payment_intent.succeeded webhook records one.
  // Bailing here made the webhook the only path that could ever promote it —
  // so a misconfigured endpoint meant paid orders silently never reached the
  // kitchen, invisible on the till (summary.js filters pending_payment out).
  // Recover the id from the Session instead, then verify it below exactly as
  // for a web card order. Still fails closed: we only promote on a genuinely
  // succeeded PaymentIntent that matches this order.
  let intentId = order.payment?.intentId;
  if (!intentId && order.payment?.checkoutSessionId) {
    try {
      const sess = await retrieveCheckoutSession(order.payment.checkoutSessionId, acct, env);
      if (sess?.payment_status === "paid" && sess.payment_intent) {
        intentId = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent.id;
      }
    } catch (e) {
      console.warn("confirm: session retrieve failed", e);
    }
  }
  if (!intentId) return j({ status: order.status, orderNumber, totalP });

  try {
    const pi = await retrievePaymentIntent(intentId, acct, env);
    if (pi?.status === 'succeeded' && paymentIntentMatchesOrder(pi, order)) {
      // Persist the recovered id + account so the order stays refundable,
      // exactly as the webhook would have done.
      order.payment = order.payment || {};
      if (!order.payment.intentId) order.payment.intentId = intentId;
      if (!order.payment.connectedAccountId && acct) order.payment.connectedAccountId = acct;
      await markOrderPaid(order, env);
      return j({ status: 'pending_accept', orderNumber, totalP });
    }
    return j({ status: order.status, orderNumber, totalP, piStatus: pi?.status || null });
  } catch (e) {
    // Non-fatal — the Stripe webhook will still promote it shortly.
    console.warn('confirm: PI retrieve failed', e);
    return j({ status: order.status, orderNumber, totalP, error: 'verify_failed' });
  }
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
