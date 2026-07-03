/* POST /api/staff/terminal/quick-charge — take a manual card payment of an arbitrary
   amount on the counter reader (no cart). Staff type the amount on the till; we create a
   card_present PaymentIntent for exactly that, AUTO-captured (nothing to re-verify), and
   push it to the online reader. The till polls /terminal/status as usual; on succeeded
   the money is already captured — there's no order to finalise. */

import { requirePermission } from '../../../_lib/permissions.js';
import { logAudit } from '../../../_lib/audit.js';
import { getConfig } from '../../../_lib/config.js';
import { cardFeeP } from '../../../_lib/counter-totals.js';
import { createPaymentIntent, listTerminalReaders, processPaymentIntentOnReader } from '../../../_lib/stripe.js';
import { newOrderId, putOrder, nextOrderNumber } from '../../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const ctx = {};
  const denied = await requirePermission(request, env, 'sell', ctx);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const amountP = Math.round(Number(body.amountP));
  if (!Number.isFinite(amountP) || amountP < 30) return err('Enter an amount of at least £0.30.', 400);
  if (amountP > 100000) return err('That amount looks too high (max £1000).', 400);

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  let readers;
  try { readers = await listTerminalReaders(acct, env); }
  catch (e) { return err('Could not reach the card reader service.', 502); }
  const online = (readers.data || []).filter((r) => r.status === 'online');
  if (online.length === 0) return err('No card reader is online. Check it is powered on and connected.', 409);
  const reader = online[0];

  const orderId = newOrderId(); // reference only — used in the PI metadata for traceability
  let pi;
  try {
    pi = await createPaymentIntent({
      amountP,
      currency: 'gbp',
      orderId,
      connectedAccountId: acct,
      applicationFeeP: cardFeeP(amountP, config),
      cardPresent: true,
      captureMethod: 'automatic',
    }, env);
  } catch (e) {
    return err('Could not start the card payment.', 502);
  }

  try {
    await processPaymentIntentOnReader(reader.id, pi.id, acct, env);
  } catch (e) {
    return err('The reader is busy or unavailable — try again.', 502);
  }

  // Record a minimal money-only order so the sale is visible in Today/Z and is
  // refundable. It starts 'pending_payment'; the payment_intent.succeeded webhook
  // promotes it to a paid + COMPLETED sale. It has no items, so it never enters
  // the kitchen queue (the webhook special-cases source 'quick-charge').
  const at = new Date().toISOString();
  const order = {
    id: orderId,
    orderNumber: await nextOrderNumber(env),
    createdAt: at,
    status: 'pending_payment',
    source: 'quick-charge',
    fulfillment: 'collection',
    schedule: 'asap',
    customer: { name: 'Quick charge', email: '', phone: '' },
    address: null,
    totals: { totalP: amountP, subtotalP: amountP, discountP: 0, deliveryFeeP: 0, serviceFeeP: 0, lines: [] },
    paymentMethod: 'counter_card',
    payment: { state: 'awaiting', intentId: pi.id, connectedAccountId: acct },
    marketing: { email: false, sms: false },
    createdBy: ctx.operator ? { id: ctx.operator.id, name: ctx.operator.name } : null,
    history: [{ at, event: 'created', source: 'quick-charge', by: ctx.operator?.name || null }],
  };
  try { await putOrder(order, env); } catch (e) { console.warn('quick-charge: putOrder failed', e); }
  await logAudit(env, {
    op: ctx.operator?.id || null, opName: ctx.operator?.name || null,
    action: 'quick_charge', target: orderId, details: { amountP },
  });

  return Response.json({
    orderId,
    paymentIntentId: pi.id,
    amountP,
    reader: { id: reader.id, label: reader.label || reader.device_type || 'Reader' },
  });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
