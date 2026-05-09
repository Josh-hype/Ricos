/* POST /api/stripe-webhook — handles payment_intent.succeeded / failed. */
import { verifyWebhook } from '../_lib/stripe.js';
import { getConfig } from '../_lib/config.js';
import { getOrder, putOrder, recordOptIn } from '../_lib/kv.js';
import { sendEmail, orderReceivedEmail } from '../_lib/email.js';

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
    if (!order) return new Response('order not found', { status: 200 });
    if (order.status === 'pending_payment') {
      order.status = 'pending_accept';
      order.payment.state = 'paid';
      order.payment.paidAt = new Date().toISOString();
      order.history.push({ at: order.payment.paidAt, event: 'paid' });
      await putOrder(order, env);

      const config = getConfig();
      const mail = orderReceivedEmail(order, config);
      await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html }, env);

      if (order.marketing.email) {
        await recordOptIn({ kind: 'email', value: order.customer.email, source: 'checkout' }, env);
      }
      if (order.marketing.sms) {
        await recordOptIn({ kind: 'sms', value: order.customer.phone, source: 'checkout' }, env);
      }
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
