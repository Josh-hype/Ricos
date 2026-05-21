/* POST /api/staff/orders/:id/status — staff moves an order through
   ready / out_for_delivery / completed / cancelled.

   Sends a rejection email when status moves to 'cancelled' from a state
   where the customer has been waiting on the kitchen's decision. */
import { requireStaff } from '../../../../_lib/auth.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';
import { sendEmail, orderRejectedEmail } from '../../../../_lib/email.js';

const ALLOWED = ['ready', 'out_for_delivery', 'completed', 'cancelled'];
const REJECTABLE_FROM = new Set(['pending_payment', 'pending_accept', 'accepted']);

export const onRequestPost = async ({ request, env, params }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const status = String(body.status || '');
  if (!ALLOWED.includes(status)) return j({ error: 'Invalid status.' }, 400);
  const reason = (body.reason || '').toString().trim().slice(0, 280);

  const wasRejectable = REJECTABLE_FROM.has(order.status);
  order.status = status;
  order.history.push({
    at: new Date().toISOString(),
    event: status,
    ...(reason ? { reason } : {}),
  });
  await putOrder(order, env);

  // Notify the customer when the kitchen rejects an order.
  // TODO: also trigger a Stripe refund for card orders; for now the email
  //       promises the refund but staff still need to issue it via Stripe.
  if (status === 'cancelled' && wasRejectable && order.customer?.email) {
    try {
      const mail = orderRejectedEmail(order, getConfig(), reason);
      await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html }, env);
    } catch (e) {
      console.warn('rejection email failed', e);
    }
  }

  return Response.json({ order });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
