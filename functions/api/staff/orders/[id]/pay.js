/* POST /api/staff/orders/:id/pay — collect payment on an order that was saved
   "unpaid" (pay later) from the till. Mirrors the counter-sale money paths but
   acts on an EXISTING order instead of creating one.

   Body:
     { tender:'cash', tenderedP? }                  → mark paid by cash (immediate)
     { tender:'card', action:'start' }              → authorise on the counter reader
                                                       → { paymentIntentId, reader, amountP }
     { tender:'card', action:'capture', paymentIntentId }
                                                     → verify + capture → mark paid

   Only an order still in payment.state==='unpaid' can be paid here, so a normal
   paid order can never be double-charged. `sell` permission + audited, like a
   counter sale. */

import { resolveSession } from '../../../../_lib/auth.js';
import { requirePermission } from '../../../../_lib/permissions.js';
import { logAudit } from '../../../../_lib/audit.js';
import { getConfig } from '../../../../_lib/config.js';
import { cardFeeP } from '../../../../_lib/counter-totals.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';
import {
  createPaymentIntent, listTerminalReaders, processPaymentIntentOnReader,
  retrievePaymentIntent, capturePaymentIntent,
} from '../../../../_lib/stripe.js';

export const onRequestPost = async ({ request, env, params }) => {
  const ctx = {};
  const denied = await requirePermission(request, env, 'sell', ctx);
  if (denied) return denied;
  const sess = await resolveSession(request, env);

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return err('Order not found.', 404);
  if ((order.payment?.state || '') !== 'unpaid') {
    return err('This order is not awaiting payment.', 409);
  }
  const totalP = order.totals?.totalP || 0;

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }
  const tender = body.tender === 'card' ? 'card' : 'cash';
  const config = getConfig();
  const operator = ctx.operator?.name || sess?.name || null;
  const operatorId = ctx.operator?.id || sess?.op || null;

  // ── Cash: mark paid immediately ────────────────────────────────────────────
  if (tender === 'cash') {
    markPaid(order, { tender: 'cash', method: 'counter_cash', by: operator });
    await putOrder(order, env);
    await audit(env, operatorId, operator, id, { tender: 'cash', totalP });
    return Response.json({ order });
  }

  // ── Card: needs a configured connected account + an online reader ───────────
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);
  const action = body.action === 'capture' ? 'capture' : 'start';

  if (action === 'start') {
    let readers;
    try { readers = await listTerminalReaders(acct, env); }
    catch (e) { return err('Could not reach the card reader service.', 502); }
    const online = (readers.data || []).filter((r) => r.status === 'online');
    if (online.length === 0) return err('No card reader is online. Check the reader is powered on and connected.', 409);
    const reader = online[0];

    let pi;
    try {
      pi = await createPaymentIntent({
        amountP: totalP,
        currency: 'gbp',
        orderId: id,
        connectedAccountId: acct,
        applicationFeeP: cardFeeP(totalP, config),
        cardPresent: true,
        // Unique per attempt so a cancel-then-retry isn't blocked by idempotency
        // returning a now-cancelled PaymentIntent (the order id is fixed here).
        idempotencyKey: `payorder_${id}_${Date.now()}`,
      }, env);
    } catch (e) { return err('Could not start the card payment.', 502); }

    try { await processPaymentIntentOnReader(reader.id, pi.id, acct, env); }
    catch (e) { return err('The reader is busy or unavailable — try again.', 502); }

    return Response.json({
      paymentIntentId: pi.id,
      amountP: totalP,
      reader: { id: reader.id, label: reader.label || reader.device_type || 'Reader' },
    });
  }

  // action === 'capture': verify this is THIS order's authorisation, then capture.
  const piId = String(body.paymentIntentId || '');
  if (!piId) return err('Missing card payment reference.', 400);
  let pi;
  try { pi = await retrievePaymentIntent(piId, acct, env); }
  catch (e) { return err('Could not verify the card payment.', 502); }
  if (pi.status !== 'requires_capture') return err(`Card not authorised yet (${pi.status}).`, 409);
  if (pi.amount !== totalP) return err('Card amount mismatch — not captured.', 409);
  if (String(pi.currency || '').toLowerCase() !== 'gbp') return err('Card currency mismatch — not captured.', 409);
  if (pi.metadata?.orderId !== id) return err('Card/order mismatch — not captured.', 409);

  try { await capturePaymentIntent(piId, acct, env); }
  catch (e) { return err('Card capture failed — the customer was not charged.', 502); }

  markPaid(order, { tender: 'card', method: 'counter_card', by: operator, intentId: piId, connectedAccountId: acct });
  await putOrder(order, env);
  await audit(env, operatorId, operator, id, { tender: 'card', totalP });
  return Response.json({ order });
};

// Flip an unpaid order to paid in place (pure mutation; caller persists).
function markPaid(order, { tender, method, by, intentId, connectedAccountId }) {
  const at = new Date().toISOString();
  order.paymentMethod = method;
  order.payment = {
    ...(order.payment || {}),
    state: 'paid', paidAt: at, tender,
    ...(intentId ? { intentId } : {}),
    ...(connectedAccountId ? { connectedAccountId } : {}),
  };
  order.history = order.history || [];
  order.history.push({ at, event: 'paid', tender, ...(by ? { by } : {}) });
}

function audit(env, op, opName, target, details) {
  return logAudit(env, { op, opName, action: 'order_paid', target, details });
}

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
