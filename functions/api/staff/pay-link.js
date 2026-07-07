/* POST /api/staff/pay-link — "pay by link" (PIN-gated).

   Staff build an order on the till and we text the customer a secure Stripe
   Checkout link to pay on their own phone. The till sends item ids + qty +
   modifiers + a sale mode + the customer's mobile — NEVER prices; we recompute
   totals from the canonical menu, server-authoritative.

   Priced like a COUNTER sale: NO service fee (it's a staff-taken order, not a
   self-serve web order) and the online 10% promo is suppressed too. With no service
   fee there's no platform application_fee, so the full amount settles to the venue.

   The order is stored status='pending_payment' and reaches the kitchen only once
   payment succeeds, exactly like a web card order: the Checkout Session's
   PaymentIntent carries metadata.orderId, so the existing payment_intent.succeeded
   webhook promotes it. It's recorded as paymentMethod 'card' (it IS a card
   payment) so refunds / takings flow through the existing card logic unchanged;
   `source` and payment.via flag that it came from a link. */

import { resolveSession } from '../../_lib/auth.js';
import { requirePermission } from '../../_lib/permissions.js';
import { getOperator } from '../../_lib/operators.js';
import { logAudit } from '../../_lib/audit.js';
import { getConfig } from '../../_lib/config.js';
import { computeTotals } from '../../_lib/totals.js';
import { resolveMenu } from '../../_lib/menu-store.js';
import { resolveDelivery } from '../../_lib/delivery.js';
import { createCheckoutSession } from '../../_lib/stripe.js';
import { putOrder, newOrderId, nextOrderNumber } from '../../_lib/kv.js';
import { sendSms, normalisePhoneE164UK } from '../../_lib/sms.js';

const MODES = new Set(['walkin', 'collection', 'delivery']);

export const onRequestPost = async ({ request, env }) => {
  // Booking real (pending) revenue — gate on `sell` and audit it, like a counter sale.
  const ctx = {};
  const denied = await requirePermission(request, env, 'sell', ctx);
  if (denied) return denied;
  const sess = await resolveSession(request, env);

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  const mode = MODES.has(body.mode) ? body.mode : 'walkin';
  const fulfillment = mode === 'delivery' ? 'delivery' : 'collection';

  // The link is texted, so a UK mobile is REQUIRED for every mode (a walk-in has
  // no other contact). Name is required for collection / delivery, like a counter sale.
  const rawName = String(body.customer?.name || '').trim().slice(0, 60);
  const name = rawName || (mode === 'walkin' ? 'Walk-in' : '');
  if (mode !== 'walkin' && name.length < 2) return err('Customer name is required.', 400);
  const phone = normalisePhoneE164UK(body.customer?.phone || '');
  if (!phone) return err('A UK mobile number is required to text the payment link.', 400);

  // Delivery: resolve the fee + address exactly like the counter / online flow.
  let address = null;
  let deliveryFeeP;
  if (mode === 'delivery') {
    if (!config.fulfillment.delivery.enabled) return err('Delivery is not configured for this shop.', 400);
    const dq = await resolveDelivery(body.address?.postcode, config);
    if (!dq.ok) return err(dq.reason, 400);
    deliveryFeeP = dq.feePence;
    const line1 = String(body.address?.line1 || '').trim().slice(0, 120);
    if (line1.length < 2) return err('Please enter a delivery address.', 400);
    address = {
      line1,
      line2: String(body.address?.line2 || '').trim().slice(0, 120),
      city: config.business.address.city,
      postcode: dq.postcode,
      notes: String(body.address?.notes || '').trim().slice(0, 280),
    };
  }

  // Price it: service fee ON (platform keeps serviceFeePlatformP as the Stripe
  // application_fee), online promo OFF. Custom / POS-only allowed (it's the till).
  const totals = computeTotals(
    { items: body.items, fulfillment, deliveryAddress: address ? { postcode: address.postcode } : undefined },
    config,
    { suppressPromo: true, suppressServiceFee: true, allowCustom: true, allowPosOnly: true, deliveryFeeP: deliveryFeeP ?? undefined, menu: await resolveMenu(env) },
  );
  if (!totals.ok) return err(totals.reason, 400);

  // Per-order staff attribution (whoever entered their code at the mode picker),
  // falling back to the signed-in session operator.
  let takenBy = sess?.op ? { id: sess.op, name: sess.name } : null;
  const tbId = String(body.takenBy?.id || '');
  if (tbId) {
    const tbOp = await getOperator(env, tbId);
    if (tbOp && tbOp.active !== false) takenBy = { id: tbOp.id, name: tbOp.name };
  }

  const id = newOrderId();
  const orderNumber = await nextOrderNumber(env);
  const at = new Date().toISOString();
  const domain = config.business?.domain || '';
  const tradingName = config.business?.tradingName || config.business?.shortName || 'Your order';

  // Hosted Stripe Checkout (Connect direct charge on the venue's account). The
  // PaymentIntent it creates carries metadata.orderId so the webhook promotes
  // this order on payment. 2-hour window before the link expires.
  let session;
  try {
    session = await createCheckoutSession({
      amountP: totals.totalP,
      currency: 'gbp',
      orderId: id,
      description: `${tradingName} — order #${orderNumber}`,
      connectedAccountId: acct,
      applicationFeeP: totals.serviceFeePlatformP || 0,
      successUrl: `https://${domain}/thank-you?ref=${id}`,
      cancelUrl: `https://${domain}/`,
      expiresAt: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    }, env);
  } catch (e) {
    console.error('createCheckoutSession failed', e);
    return err('Could not create the payment link — please try again.', 502);
  }
  const link = session.url;
  if (!link) return err('Stripe did not return a payment link.', 502);
  // Text a SHORT branded link that 302-redirects to the (long) Stripe Checkout URL.
  // The raw Stripe URL is ~600 chars with a #fragment; SMS clients truncate it so the
  // tap opens a broken page. /pay/:id looks the order up and forwards to `payment.link`.
  const payUrl = domain ? `https://${domain}/pay/${id}` : link;

  const order = {
    id,
    orderNumber,
    createdAt: at,
    status: 'pending_payment',
    source: `link-${mode}`,
    fulfillment,
    schedule: 'asap',
    customer: { name, email: '', phone },
    address,
    totals,
    paymentMethod: 'card',
    payment: {
      state: 'awaiting',
      via: 'link',
      connectedAccountId: acct,
      checkoutSessionId: session.id,
      link,
    },
    marketing: { email: false, sms: false },
    createdBy: takenBy,
    history: [
      { at, event: 'created', source: `link-${mode}`, by: takenBy?.name || null },
      { at, event: 'payment_link_sent' },
    ],
  };
  await putOrder(order, env);

  // Text the link. Falls back gracefully — if Twilio isn't configured or errors,
  // we still return the link so the till can show a "copy link" button instead.
  const smsBody = `${tradingName}: tap to pay for order #${orderNumber} (£${(totals.totalP / 100).toFixed(2)}) — ${payUrl}`;
  let smsRes;
  try { smsRes = await sendSms({ to: phone, body: smsBody }, env); }
  catch (e) { smsRes = { error: String(e?.message || e) }; }
  const smsSent = !!(smsRes && smsRes.sid);

  await logAudit(env, {
    op: takenBy?.id || ctx.operator?.id || null,
    opName: takenBy?.name || ctx.operator?.name || sess?.name || null,
    action: 'pay_link', target: id,
    details: { mode, totalP: totals.totalP, smsSent },
  });

  // Return the short link too, so the till's "copy link" fallback shares it.
  return Response.json({ ok: true, order, link: payUrl, smsSent });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
