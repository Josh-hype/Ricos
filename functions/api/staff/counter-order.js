/* POST /api/staff/counter-order — record an in-person till sale (PIN-gated).
   The till sends item ids + qty + modifiers + a sale mode (walkin / collection /
   delivery) and any customer details — NEVER prices; we recompute totals from the
   canonical menu (shared with the card-charge endpoint via priceCounterSale).

   Cash: persisted immediately, status='accepted' + payment.state='paid', so it
   lands on Live and counts in Today / Z report (paymentMethod 'counter_cash').

   Card (counter_card): the amount was authorised on a Terminal reader by
   /api/staff/terminal/charge. This endpoint REQUIRES the resulting paymentIntentId
   + orderId, re-verifies status/amount/currency/order-binding, then CAPTURES — an
   order is marked paid only on a real capture (closes P2-10). It fails closed: no
   paymentIntent ⇒ error, never a paid-but-uncaptured order. */

import { resolveSession } from '../../_lib/auth.js';
import { requirePermission } from '../../_lib/permissions.js';
import { getOperator } from '../../_lib/operators.js';
import { logAudit } from '../../_lib/audit.js';
import { getConfig } from '../../_lib/config.js';
import { priceCounterSale } from '../../_lib/counter-totals.js';
import { retrievePaymentIntent, capturePaymentIntent } from '../../_lib/stripe.js';
import { putOrder, newOrderId, nextOrderNumber } from '../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  // A counter sale books real revenue — gate it on `sell` (a no-op in legacy mode)
  // and audit it, like refunds/voids.
  const ctx = {};
  const denied = await requirePermission(request, env, 'sell', ctx);
  if (denied) return denied;
  const sess = await resolveSession(request, env);

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  // cash (default) · card (Terminal) · unpaid (save now, collect payment later
  // from the order's "Pay now" action — lands on Live but counts as £0 takings).
  const tender = body.tender === 'card' ? 'card'
    : (body.tender === 'unpaid' ? 'unpaid' : 'cash');
  const config = getConfig();

  // Price the sale (server-authoritative; identical maths to /terminal/charge).
  const priced = await priceCounterSale({ items: body.items, mode: body.mode, address: body.address }, config);
  if (!priced.ok) return err(priced.error, 400);
  const { mode, fulfillment, totals, address } = priced;

  // Customer. Walk-ins get a placeholder; collection / delivery need a name + phone.
  const rawName = String(body.customer?.name || '').trim().slice(0, 60);
  const rawPhone = String(body.customer?.phone || '').trim().slice(0, 30);
  const name = rawName || (mode === 'walkin' ? 'Walk-in' : '');
  if (mode !== 'walkin' && name.length < 2) return err('Customer name is required.', 400);
  if (mode !== 'walkin' && rawPhone.length < 6) return err('Customer phone is required.', 400);

  // Card: verify the Terminal authorisation, then capture. The order id is the one
  // the PI metadata points at (minted by /terminal/charge) so the link is consistent.
  let id = newOrderId();
  let paymentExtra = {};
  if (tender === 'card') {
    const piId = String(body.paymentIntentId || '');
    const chargeOrderId = String(body.orderId || '');
    if (!piId || !chargeOrderId) return err('Card payment not started — start it on the reader first.', 400);
    const acct = config.stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

    let pi;
    try { pi = await retrievePaymentIntent(piId, acct, env); }
    catch (e) { return err('Could not verify the card payment.', 502); }

    // Mirror the web PI-match guard: capture only an authorisation that matches THIS
    // sale, to the penny, in the right currency, for the right order.
    if (pi.status !== 'requires_capture') return err(`Card not authorised yet (${pi.status}).`, 409);
    if (pi.amount !== totals.totalP) return err('Card amount mismatch — not captured.', 409);
    if (String(pi.currency || '').toLowerCase() !== 'gbp') return err('Card currency mismatch — not captured.', 409);
    if (pi.metadata?.orderId !== chargeOrderId) return err('Card/order mismatch — not captured.', 409);

    try { await capturePaymentIntent(piId, acct, env); }
    catch (e) { return err('Card capture failed — the customer was not charged.', 502); }

    id = chargeOrderId;
    paymentExtra = { intentId: piId, connectedAccountId: acct };
  }

  // Default ready time uses the shop's ASAP prep, same as the website.
  const prepMin = Math.max(5, Math.min(180, Number(config.ordering?.asapMinPrepMinutes) || 20));
  const at = new Date().toISOString();
  const readyAt = new Date(Date.now() + prepMin * 60000).toISOString();

  // Per-order staff attribution: the till may be left signed in as one operator,
  // but the order is credited to whoever entered their code at the mode picker.
  // Validate the supplied id against the operator store (canonical name); fall back
  // to the signed-in session operator.
  let takenBy = sess?.op ? { id: sess.op, name: sess.name } : null;
  const tbId = String(body.takenBy?.id || '');
  if (tbId) {
    const tbOp = await getOperator(env, tbId);
    if (tbOp && tbOp.active !== false) takenBy = { id: tbOp.id, name: tbOp.name };
  }

  const orderNumber = await nextOrderNumber(env);
  const order = {
    id,
    orderNumber,
    createdAt: at,
    status: 'accepted',
    source: `counter-${mode}`,
    fulfillment,
    schedule: 'asap',
    readyAt,
    customer: { name, email: '', phone: rawPhone },
    address,
    totals,
    paymentMethod: tender === 'card' ? 'counter_card'
      : (tender === 'unpaid' ? 'unpaid' : 'counter_cash'),
    payment: tender === 'unpaid'
      ? { state: 'unpaid' }
      : { state: 'paid', paidAt: at, tender, ...paymentExtra },
    marketing: { email: false, sms: false },
    createdBy: takenBy,
    history: [
      { at, event: 'created', source: `counter-${mode}`, by: takenBy?.name || null },
      ...(tender === 'unpaid' ? [] : [{ at, event: 'paid', tender }]),
      { at, event: 'accepted', readyAt },
    ],
  };

  await putOrder(order, env);
  await logAudit(env, {
    op: takenBy?.id || ctx.operator?.id || null,
    opName: takenBy?.name || ctx.operator?.name || sess?.name || null,
    action: 'counter_sale', target: id,
    details: { mode, tender, totalP: totals.totalP, takenBy: takenBy?.name || null },
  });
  return Response.json({ order });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
