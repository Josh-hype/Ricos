/* POST /api/staff/orders/:id/status — staff moves an order through
   ready / out_for_delivery / completed / cancelled.

   Sends a rejection email when status moves to 'cancelled' from a state
   where the customer has been waiting on the kitchen's decision. */
import { requirePermission } from '../../../../_lib/permissions.js';
import { logAudit } from '../../../../_lib/audit.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder, recordRefund, refundedSoFar } from '../../../../_lib/kv.js';
import { sendEmail, orderRejectedEmail } from '../../../../_lib/email.js';
import { createRefund } from '../../../../_lib/stripe.js';

const ALLOWED = ['ready', 'out_for_delivery', 'completed', 'cancelled'];
const REJECTABLE_FROM = new Set(['pending_payment', 'pending_accept', 'accepted']);

// Auto-refund the remaining balance of a paid card order when it's rejected
// (full refund, incl. the platform service fee when nothing was refunded yet).
// Mutates `order`; never throws — a failed refund must not block the
// cancellation, it's flagged for a manual one.
async function refundOnReject(order, env) {
  const p = order.payment || {};
  if (order.paymentMethod !== 'card' || !p.intentId || !['paid', 'partly_refunded'].includes(p.state)) {
    return null;
  }
  const prior = refundedSoFar(order);
  const remaining = (order.totals?.totalP || 0) - prior;
  if (remaining <= 0) return { ok: true, amountP: 0 };
  // This refund completes the order, so return the platform fee unless an
  // earlier refund already did.
  const refundFee = !p.feeRefunded;
  try {
    const refund = await createRefund({
      paymentIntentId: p.intentId,
      amountP: remaining,
      refundApplicationFee: refundFee,
      idempotencyKey: `refund_${p.intentId}_${prior}_${remaining}`,
    }, p.connectedAccountId, env);
    const amt = refund.amount ?? remaining;
    recordRefund(order, { amountP: amt, reason: 'order cancelled', stripeId: refund.id });
    if (refundFee) order.payment.feeRefunded = true;
    return { ok: true, amountP: amt };
  } catch (e) {
    console.error('auto-refund failed', e);
    order.payment.refundFailed = true;
    order.history.push({ at: new Date().toISOString(), event: 'refund_failed', error: e?.message || 'unknown' });
    return { ok: false, error: e?.message || 'refund failed' };
  }
}

export const onRequestPost = async ({ request, env, params }) => {
  const ctx = {};
  const denied = await requirePermission(request, env, 'orders.manage', ctx);
  if (denied) return denied;

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const status = String(body.status || '');
  if (!ALLOWED.includes(status)) return j({ error: 'Invalid status.' }, 400);
  const reason = (body.reason || '').toString().trim().slice(0, 280);

  // An unpaid "pay later" order can't be completed until it's settled — it stays
  // on the live board. (It can still be cancelled, or progressed to ready.)
  if (status === 'completed' && ((order.payment && order.payment.state === 'unpaid') || order.paymentMethod === 'unpaid')) {
    return j({ error: 'Order is unpaid — take payment before completing it.' }, 409);
  }

  // Cancelling auto-refunds a paid card order, so it needs the void permission
  // (a manager can authorise it for a staff operator via the approval token).
  const voidCtx = {};
  if (status === 'cancelled') {
    const vd = await requirePermission(request, env, 'void', voidCtx, { orderId: id });
    if (vd) return vd;
  }

  const wasRejectable = REJECTABLE_FROM.has(order.status);
  order.status = status;
  order.history.push({
    at: new Date().toISOString(),
    event: status,
    ...(reason ? { reason } : {}),
    ...(ctx.operator?.name ? { by: ctx.operator.name } : {}),
    ...(voidCtx.approver?.name ? { approvedBy: voidCtx.approver.name } : {}),
  });

  // Refund a paid card order on rejection before persisting, so the order's
  // saved state reflects the refund outcome in a single write.
  let refund = null;
  if (status === 'cancelled' && wasRejectable) {
    refund = await refundOnReject(order, env);
  }

  await putOrder(order, env);

  if (status === 'cancelled') {
    await logAudit(env, {
      op: ctx.operator?.id || null, opName: ctx.operator?.name || null,
      approverId: voidCtx.approver?.id || null, approverName: voidCtx.approver?.name || null,
      action: 'void', target: id, details: { reason: reason || null, refundedP: refund?.amountP ?? null },
    });
  }

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
