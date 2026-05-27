/* POST /api/staff/orders/:id/status — staff moves an order through
   ready / out_for_delivery / completed / cancelled.

   Sends a rejection email when status moves to 'cancelled' from a state
   where the customer has been waiting on the kitchen's decision. */
import { requireStaff } from '../../../../_lib/auth.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';
import { sendEmail, orderRejectedEmail } from '../../../../_lib/email.js';
import { createRefund } from '../../../../_lib/stripe.js';

const ALLOWED = ['ready', 'out_for_delivery', 'completed', 'cancelled'];
const REJECTABLE_FROM = new Set(['pending_payment', 'pending_accept', 'accepted']);

// Auto-refund a paid card order when it's rejected. Full refund including the
// platform service fee. Mutates `order` with the outcome; never throws — a
// failed refund must not block the cancellation, it's flagged for a manual one.
async function refundOnReject(order, env) {
  const p = order.payment || {};
  const refundable = order.paymentMethod === 'card'
    && p.state === 'paid'
    && p.intentId
    && p.refund?.state !== 'succeeded';
  if (!refundable) return null;
  const at = new Date().toISOString();
  try {
    const refund = await createRefund(
      { paymentIntentId: p.intentId, refundApplicationFee: true },
      p.connectedAccountId, env,
    );
    p.refund = { state: 'succeeded', id: refund.id, amountP: refund.amount, at };
    p.state = 'refunded';
    order.payment = p;
    order.history.push({ at, event: 'refunded', amountP: refund.amount });
    return { ok: true, amountP: refund.amount };
  } catch (e) {
    console.error('auto-refund failed', e);
    p.refund = { state: 'failed', error: e?.message || 'unknown', at };
    order.payment = p;
    order.history.push({ at, event: 'refund_failed', error: p.refund.error });
    return { ok: false, error: e?.message || 'refund failed' };
  }
}

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

  // Refund a paid card order on rejection before persisting, so the order's
  // saved state reflects the refund outcome in a single write.
  let refund = null;
  if (status === 'cancelled' && wasRejectable) {
    refund = await refundOnReject(order, env);
  }

  await putOrder(order, env);

  // Notify the customer when the kitchen rejects an order. The refund (if a
  // paid card order) has already been attempted above; a failure is flagged on
  // order.payment.refund for staff to action manually in Stripe.
  if (status === 'cancelled' && wasRejectable && order.customer?.email) {
    try {
      const mail = orderRejectedEmail(order, getConfig(), reason);
      await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html, fromName: mail.fromName }, env);
    } catch (e) {
      console.warn('rejection email failed', e);
    }
  }

  return Response.json({ order, refund });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
