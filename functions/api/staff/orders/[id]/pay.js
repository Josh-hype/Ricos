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
  // Accept an order awaiting payment: an in-store saved-unpaid "pay later", an
  // online cash-on-collection/delivery order ('cash_due' — e.g. cash collected by
  // the driver), or a part-paid split (each person settles their share in turn).
  const pstate = order.payment?.state || '';
  if (pstate !== 'unpaid' && pstate !== 'part_paid' && pstate !== 'cash_due') {
    return err('This order is not awaiting payment.', 409);
  }
  const totalP = order.totals?.totalP || 0;
  const paidSoFar = (order.payment?.parts || []).reduce((a, p) => a + (p.amountP || 0), 0);
  const remaining = totalP - paidSoFar;
  if (remaining <= 0) return err('This order is already paid.', 409);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }
  const tender = body.tender === 'card' ? 'card' : 'cash';
  const config = getConfig();
  // Shop with its own card machine: a card collection is booked immediately (no reader).
  const externalCard = !!(config.pos && config.pos.externalCardMachine);
  const operator = ctx.operator?.name || sess?.name || null;
  const operatorId = ctx.operator?.id || sess?.op || null;

  // The part to collect now. Default = the whole remaining balance; a split bill
  // passes amountP for one person's share. Never collect more than remains.
  let partP = remaining;
  if (body.amountP != null) {
    partP = Math.round(Number(body.amountP) || 0);
    if (!(partP > 0)) return err('Enter an amount to collect.', 400);
    if (partP > remaining) partP = remaining;
  }

  // ── Cash, or card on the shop's own machine: record the part immediately ────
  // External card = the customer paid on a third-party terminal; there's no
  // LumiPOS reader to drive, so we book it like cash but record it as card.
  if (tender === 'cash' || (tender === 'card' && externalCard)) {
    applyPart(order, { tender, amountP: partP, by: operator, external: tender === 'card' });
    await putOrder(order, env);
    await audit(env, operatorId, operator, id, { tender, amountP: partP, ...(tender === 'card' ? { external: true } : {}) });
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
        amountP: partP,
        currency: 'gbp',
        orderId: id,
        connectedAccountId: acct,
        applicationFeeP: cardFeeP(partP, config),
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
      amountP: partP,
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
  // The authorised amount IS the part being collected — capture only that, and
  // never more than the order's outstanding balance.
  if (pi.amount > remaining) return err('Card amount exceeds the balance — not captured.', 409);
  if (String(pi.currency || '').toLowerCase() !== 'gbp') return err('Card currency mismatch — not captured.', 409);
  if (pi.metadata?.orderId !== id) return err('Card/order mismatch — not captured.', 409);

  try { await capturePaymentIntent(piId, acct, env); }
  catch (e) { return err('Card capture failed — the customer was not charged.', 502); }

  applyPart(order, { tender: 'card', amountP: pi.amount, by: operator, intentId: piId, connectedAccountId: acct });
  await putOrder(order, env);
  await audit(env, operatorId, operator, id, { tender: 'card', amountP: pi.amount });
  return Response.json({ order });
};

// Append one payment part and recompute the order's paid state. A single full
// payment ⇒ one part, state 'paid', a plain cash/card method (unchanged from the
// old behaviour). Multiple parts (a split bill) ⇒ the balance fills to 'paid' and
// the method becomes 'split'.
function applyPart(order, { tender, amountP, by, intentId, connectedAccountId, external }) {
  const at = new Date().toISOString();
  order.payment = order.payment || {};
  const parts = Array.isArray(order.payment.parts) ? order.payment.parts.slice() : [];
  parts.push({ tender, amountP, at, ...(external ? { external: true } : {}), ...(intentId ? { intentId } : {}), ...(connectedAccountId ? { connectedAccountId } : {}) });
  const paidP = parts.reduce((a, p) => a + (p.amountP || 0), 0);
  const total = order.totals?.totalP || 0;
  const fullyPaid = paidP >= total;
  const split = parts.length > 1;
  order.payment = {
    ...order.payment,
    parts,
    paidP,
    state: fullyPaid ? 'paid' : 'part_paid',
    tender: split ? 'split' : tender,
    ...(fullyPaid ? { paidAt: at } : {}),
    ...(intentId ? { intentId, connectedAccountId } : {}),
  };
  order.paymentMethod = split ? 'split' : (tender === 'card' ? 'counter_card' : 'counter_cash');
  order.history = order.history || [];
  order.history.push({ at, event: fullyPaid ? 'paid' : 'part_paid', tender, amountP, ...(by ? { by } : {}) });
}

function audit(env, op, opName, target, details) {
  return logAudit(env, { op, opName, action: 'order_paid', target, details });
}

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
