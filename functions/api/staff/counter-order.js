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
import { resolveMenu } from '../../_lib/menu-store.js';
import { retrievePaymentIntent, capturePaymentIntent } from '../../_lib/stripe.js';
import { putOrder, newOrderId, nextOrderNumber } from '../../_lib/kv.js';

// Verify a Terminal authorisation matches this sale, then capture it. Idempotent
// and crash-safe: if a prior attempt already captured (status 'succeeded'), it
// reports success without re-capturing (so a failed putOrder can be safely
// retried), and a throwing capture call is re-checked against Stripe before we
// ever tell staff "not charged" (a lost response must not trigger a second
// charge). Returns { ok:true } or { ok:false, error, status }.
async function verifyAndCapture(piId, acct, env, expectedAmountP, chargeOrderId) {
  let pi;
  try { pi = await retrievePaymentIntent(piId, acct, env); }
  catch { return { ok: false, error: 'Could not verify the card payment.', status: 502 }; }
  if (pi.status !== 'requires_capture' && pi.status !== 'succeeded') {
    return { ok: false, error: `Card not authorised yet (${pi.status}).`, status: 409 };
  }
  if (pi.amount !== expectedAmountP) return { ok: false, error: 'Card amount mismatch — not captured.', status: 409 };
  if (String(pi.currency || '').toLowerCase() !== 'gbp') return { ok: false, error: 'Card currency mismatch — not captured.', status: 409 };
  if (pi.metadata?.orderId !== chargeOrderId) return { ok: false, error: 'Card/order mismatch — not captured.', status: 409 };
  if (pi.status === 'requires_capture') {
    try {
      await capturePaymentIntent(piId, acct, env);
    } catch {
      // The capture call threw — but it may have actually succeeded (a dropped
      // response). Re-check before telling staff nothing was charged.
      let after = null;
      try { after = await retrievePaymentIntent(piId, acct, env); } catch {}
      if (!after || after.status !== 'succeeded') {
        return { ok: false, error: 'Card capture failed — the customer was not charged.', status: 502 };
      }
    }
  }
  return { ok: true };
}

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
    : body.tender === 'unpaid' ? 'unpaid'
    : body.tender === 'split' ? 'split'
    : 'cash';
  const config = getConfig();
  // Shops with their own (third-party) card machine record card sales without a
  // LumiPOS reader/Stripe. Server-gated, so it can't be abused where a reader is used.
  const externalCard = !!(config.pos && config.pos.externalCardMachine);

  // Price the sale (server-authoritative; identical maths to /terminal/charge).
  const priced = await priceCounterSale({ items: body.items, mode: body.mode, address: body.address }, config, { menu: await resolveMenu(env) });
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
  let cardExternal = false;
  if (tender === 'card') {
    if (externalCard) {
      // The shop's own card machine took the payment — there's no Stripe
      // PaymentIntent to verify/capture. Recorded as paid by card below.
      cardExternal = true;
    } else {
      const piId = String(body.paymentIntentId || '');
      const chargeOrderId = String(body.orderId || '');
      if (!piId || !chargeOrderId) return err('Card payment not started — start it on the reader first.', 400);
      const acct = config.stripe?.connectedAccountId;
      if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

      // Verify + capture (idempotent, crash-safe — see verifyAndCapture).
      const vc = await verifyAndCapture(piId, acct, env, totals.totalP, chargeOrderId);
      if (!vc.ok) return err(vc.error, vc.status);

      id = chargeOrderId;
      paymentExtra = { intentId: piId, connectedAccountId: acct };
    }
  }

  // Split: part cash + part card. /terminal/charge authorised the CARD portion;
  // here we verify that authorisation equals (total − cash), capture it, and
  // record both parts so the order is fully paid (parts sum to the total).
  let splitParts = null;
  if (tender === 'split') {
    const cashP = Math.max(0, Math.min(totals.totalP, Math.round(Number(body.cashP) || 0)));
    const cardP = totals.totalP - cashP;
    if (cardP <= 0) return err('The card part of a split must be more than £0 — use plain Cash instead.', 400);
    const splitAt = new Date().toISOString();
    if (externalCard) {
      // Card portion taken on the shop's own machine — no reader / PaymentIntent.
      splitParts = [
        { tender: 'cash', amountP: cashP, at: splitAt },
        { tender: 'card', amountP: cardP, at: splitAt, external: true },
      ];
    } else {
      const piId = String(body.paymentIntentId || '');
      const chargeOrderId = String(body.orderId || '');
      if (!piId || !chargeOrderId) return err('Card payment not started — start it on the reader first.', 400);
      const acct = config.stripe?.connectedAccountId;
      if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

      // Verify + capture the CARD portion (idempotent, crash-safe).
      const vc = await verifyAndCapture(piId, acct, env, cardP, chargeOrderId);
      if (!vc.ok) return err(vc.error, vc.status);

      id = chargeOrderId;
      paymentExtra = { intentId: piId, connectedAccountId: acct };
      splitParts = [
        { tender: 'cash', amountP: cashP, at: splitAt },
        { tender: 'card', amountP: cardP, at: splitAt, intentId: piId, connectedAccountId: acct },
      ];
    }
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
      : tender === 'unpaid' ? 'unpaid'
      : tender === 'split' ? 'split'
      : 'counter_cash',
    payment: tender === 'unpaid'
      ? { state: 'unpaid' }
      : tender === 'split'
        ? { state: 'paid', paidAt: at, tender: 'split', paidP: totals.totalP, parts: splitParts, ...paymentExtra }
        : { state: 'paid', paidAt: at, tender, ...(cardExternal ? { external: true } : {}), ...paymentExtra },
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
    details: { mode, tender, totalP: totals.totalP, takenBy: takenBy?.name || null, ...(cardExternal ? { external: true } : {}) },
  });
  return Response.json({ order });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
