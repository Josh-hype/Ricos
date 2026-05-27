/* POST /api/staff/orders/:id/refund — staff-issued refund on a paid card order
   (PIN-gated). Distinct from cancelling: this returns money without changing the
   order's lifecycle status, so it works on completed orders too.

   Body: { mode: 'full' | 'partial', amountP?, reason? }
   - full:    refunds the remaining balance (and the platform service fee if
              nothing has been refunded yet).
   - partial: refunds amountP (pence), capped at the remaining balance.

   Verifies and records server-side; supports multiple partial refunds and won't
   over-refund. */
import { requireStaff } from '../../../../_lib/auth.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder, recordRefund, refundedSoFar } from '../../../../_lib/kv.js';
import { createRefund } from '../../../../_lib/stripe.js';
import { sendEmail, orderRefundEmail } from '../../../../_lib/email.js';

export const onRequestPost = async ({ request, env, params }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);

  const p = order.payment || {};
  if (order.paymentMethod !== 'card' || !p.intentId || !['paid', 'partly_refunded'].includes(p.state)) {
    return j({ error: 'This order has no card payment to refund.' }, 400);
  }

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const total = order.totals?.totalP || 0;
  const prior = refundedSoFar(order);
  const remaining = total - prior;
  if (remaining <= 0) return j({ error: 'This order is already fully refunded.' }, 409);

  const mode = body.mode === 'partial' ? 'partial' : 'full';
  let amount, reason;
  if (mode === 'full') {
    amount = remaining;
    reason = '';
  } else {
    // Partial = sum of the selected lines' exact discounted share of what the
    // customer paid: lineTotal × (subtotal − discount) / subtotal. Computed here
    // (not trusted from the client) from the order's own totals. Per-order fees
    // (delivery/service) are not refunded with individual items.
    const lines = order.totals?.lines || [];
    const sub = order.totals?.subtotalP || 0;
    const disc = order.totals?.discountP || 0;
    const shareOf = (l) => (sub > 0 ? Math.round((l.lineTotalP || 0) * (sub - disc) / sub) : (l.lineTotalP || 0));
    const idxs = Array.isArray(body.lineIndexes) ? body.lineIndexes : [];
    const names = [];
    amount = 0;
    for (const raw of idxs) {
      const l = lines[Number(raw)];
      if (!l) continue;
      amount += shareOf(l);
      names.push(`${l.qty}× ${l.name}`);
    }
    if (!(amount > 0)) return j({ error: 'Choose at least one item to refund.' }, 400);
    if (amount > remaining) amount = remaining;
    reason = (body.reason || names.join(', ') || 'partial refund').toString().trim().slice(0, 280);
  }

  try {
    const refund = await createRefund({
      paymentIntentId: p.intentId,
      amountP: amount,
      refundApplicationFee: prior === 0 && amount === total,
      idempotencyKey: `refund_${p.intentId}_${prior}`,
    }, p.connectedAccountId, env);
    const amt = refund.amount ?? amount;
    recordRefund(order, { amountP: amt, reason: reason || 'full refund', stripeId: refund.id });
    await putOrder(order, env);

    if (order.customer?.email) {
      try {
        const m = orderRefundEmail(order, getConfig(), amt, reason);
        await sendEmail({ to: order.customer.email, subject: m.subject, html: m.html, fromName: m.fromName }, env);
      } catch (e) { console.warn('refund email failed', e); }
    }

    return j({
      ok: true,
      amountP: amt,
      refundedTotalP: order.payment.refundedTotalP,
      fullyRefunded: order.payment.refundedTotalP >= total,
    });
  } catch (e) {
    console.error('refund failed', e);
    return j({ ok: false, error: e?.message || 'Refund failed.' }, 502);
  }
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
