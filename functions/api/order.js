/* POST /api/order — create an order.

   For card orders we create a Stripe PaymentIntent and return its
   clientSecret. The order is stored with status='pending_payment' and gets
   promoted to 'pending_accept' by the Stripe webhook on success.

   For cash orders we store the order immediately with status='pending_accept'
   and send the customer their first confirmation email. */

import { getConfig } from '../_lib/config.js';
import { computeTotals } from '../_lib/totals.js';
import { resolveDelivery } from '../_lib/delivery.js';
import { isOpenNow, isSlotValid, listSlots } from '../_lib/hours.js';
import { createPaymentIntent, createCustomer } from '../_lib/stripe.js';
import { putOrder, newOrderId, recordOptIn, incrSlotCount } from '../_lib/kv.js';
import { normalisePhoneE164UK } from '../_lib/sms.js';
import { readCustomerSession } from '../_lib/customer-auth.js';
import { getCustomer, putCustomer, upsertAddress, updateContactDetails } from '../_lib/customer.js';

export const onRequestPost = async (ctx) => {
  // TEMP DEBUG (go-live): wrap the whole handler so any unhandled throw is
  // returned as a readable message instead of a bare platform 502. Revert
  // once payments are confirmed working.
  try {
    return await handleOrderRequest(ctx);
  } catch (e) {
    console.error('order handler crashed', e);
    return errJson('DEBUG order crash: ' + (e && e.message ? e.message : String(e)), 502);
  }
};

const handleOrderRequest = async ({ request, env }) => {
  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid JSON', 400); }

  const config = getConfig();

  // Customer fields.
  const name = (input.customer?.name || '').trim();
  const email = (input.customer?.email || '').trim().toLowerCase();
  const phoneRaw = (input.customer?.phone || '').trim();
  const phone = normalisePhoneE164UK(phoneRaw);
  if (name.length < 2) return errJson('Please enter your name.', 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errJson('Please enter a valid email.', 400);
  if (!phone) return errJson('Please enter a UK mobile number.', 400);

  // Fulfillment.
  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'collection';
  let address = null;
  let deliveryFeeP = null;
  if (fulfillment === 'delivery') {
    if (!config.fulfillment.delivery.enabled) return errJson('Delivery is not available right now.', 400);
    const dq = await resolveDelivery(input.deliveryAddress?.postcode, config);
    if (!dq.ok) return errJson(dq.reason, 400);
    deliveryFeeP = dq.feePence;
    const line1 = (input.deliveryAddress?.line1 || '').trim();
    if (line1.length < 2) return errJson('Please enter your delivery address.', 400);
    address = {
      line1,
      line2: (input.deliveryAddress?.line2 || '').trim(),
      city: config.business.address.city,
      postcode: dq.postcode,
      notes: (input.deliveryAddress?.notes || '').trim().slice(0, 280),
    };
  }

  // Schedule. 'asap' or an ISO timestamp string.
  // ASAP outside opening hours silently maps to the next available slot —
  // the customer doesn't need to know we're closed; we just queue them for
  // opening time.
  let schedule = 'asap';
  if (input.schedule && input.schedule !== 'asap') {
    if (!isSlotValid(input.schedule, config)) {
      return errJson('That time slot is no longer available — please pick another.', 400);
    }
    schedule = input.schedule;
  } else if (!isOpenNow(config)) {
    const slots = listSlots(config);
    if (slots.length === 0) {
      return errJson("Sorry, we're not taking orders right now. Please call the shop.", 400);
    }
    schedule = slots[0];
  }

  // Totals (server-side; client never trusted for prices).
  const totals = computeTotals(input, config, { deliveryFeeP });
  if (!totals.ok) return errJson(totals.reason, 400);

  // Payment method.
  const paymentMethod = ['card', 'cash_collection', 'cash_delivery'].includes(input.paymentMethod)
    ? input.paymentMethod : null;
  if (!paymentMethod) return errJson('Please choose a payment method.', 400);
  if (paymentMethod === 'card' && !config.payments.stripeEnabled) return errJson('Card payments unavailable.', 400);
  if (paymentMethod === 'cash_collection' && (fulfillment !== 'collection' || !config.payments.cashOnCollectionEnabled)) {
    return errJson('Cash on collection is not available for this order.', 400);
  }
  if (paymentMethod === 'cash_delivery' && (fulfillment !== 'delivery' || !config.payments.cashOnDeliveryEnabled)) {
    return errJson('Cash on delivery is not available for this order.', 400);
  }

  // Build base order.
  const id = newOrderId();
  const createdAt = new Date().toISOString();
  const order = {
    id,
    createdAt,
    status: paymentMethod === 'card' ? 'pending_payment' : 'pending_accept',
    fulfillment,
    schedule,
    customer: { name, email, phone },
    address,
    totals,
    paymentMethod,
    payment: { state: paymentMethod === 'card' ? 'awaiting' : 'cash_due' },
    marketing: {
      email: !!input.marketing?.email,
      sms: !!input.marketing?.sms,
    },
    history: [{ at: createdAt, event: 'created' }],
  };

  // Resolve the signed-in customer (if any) up-front so we can attach the
  // Stripe Customer on the PaymentIntent when needed for saved cards.
  let session = null;
  let storedCustomer = null;
  try {
    session = await readCustomerSession(request.headers.get('Cookie'), env);
    if (session) storedCustomer = await getCustomer(session.contact, env);
  } catch (e) {
    console.warn('reading session failed', e);
  }

  // saveCard: caller wants the new card stored for future orders.
  // paymentMethodId: caller wants to pay with an already-saved card (pm_xxx).
  // Both require a signed-in customer with a Stripe Customer on this shop's
  // connected account.
  const saveCard = !!input.saveCard;
  const paymentMethodIdInput = (input.paymentMethodId || '').trim() || null;

  // Card flow: create PaymentIntent on the venue's connected Stripe
  // account (Stripe Connect direct charge). The platform retains the
  // service fee via application_fee_amount.
  if (paymentMethod === 'card') {
    const connectedAccountId = config.stripe?.connectedAccountId;
    if (!connectedAccountId || connectedAccountId === 'TBD') {
      return errJson('Card payments are not configured yet. Please choose cash, or contact us.', 503);
    }

    // If saving a new card or paying with a saved one, we need a Stripe
    // Customer on the connected account. Lazy-create if missing; persist
    // the cus_xxx onto our KV customer record for next time.
    let stripeCustomerId = storedCustomer?.stripeCustomerId || null;
    if ((saveCard || paymentMethodIdInput) && storedCustomer && !stripeCustomerId) {
      try {
        const newStripeCust = await createCustomer({
          email, name, phone,
          metadata: { app_customer_id: storedCustomer.id, app_contact: storedCustomer.contact },
        }, connectedAccountId, env);
        stripeCustomerId = newStripeCust.id;
        storedCustomer.stripeCustomerId = stripeCustomerId;
      } catch (e) {
        console.error('Stripe createCustomer failed', e);
        // Non-fatal for save-card: fall through to a normal payment without
        // saving. Fatal if the caller actually wanted to pay with a saved
        // card (we'd have no customer to charge against).
        if (paymentMethodIdInput) {
          return errJson("Couldn't access your saved cards. Please try with a new card.", 502);
        }
      }
    }
    if (paymentMethodIdInput && !stripeCustomerId) {
      return errJson('Saved card requires a signed-in account. Please sign in and try again.', 401);
    }

    // High-value saved-card orders re-prompt for CVV as a defence against
    // account takeover. Threshold is per-shop config; 0 / missing disables.
    const cvcThresholdP = Number(config.payments?.savedCardCvcThresholdPence) || 0;
    const requireCvcRecollection = !!paymentMethodIdInput
      && cvcThresholdP > 0
      && totals.totalP > cvcThresholdP;

    try {
      const pi = await createPaymentIntent({
        amountP: totals.totalP,
        currency: 'gbp',
        orderId: id,
        customerEmail: email,
        connectedAccountId,
        applicationFeeP: totals.serviceFeeP || 0,
        customerId: stripeCustomerId || undefined,
        setupFutureUsage: saveCard && stripeCustomerId ? 'off_session' : undefined,
        paymentMethodId: paymentMethodIdInput || undefined,
        requireCvcRecollection,
      }, env);
      order.payment.intentId = pi.id;
      order.payment.clientSecret = pi.client_secret;
      order.payment.connectedAccountId = connectedAccountId;
      if (stripeCustomerId) order.payment.stripeCustomerId = stripeCustomerId;
      order.payment.piStatus = pi.status;
    } catch (e) {
      // We only create the PaymentIntent here (we no longer confirm
      // server-side), so failures are creation errors, not card declines —
      // those surface client-side at confirm time. Treat any throw as a
      // service error.
      console.error('Stripe PI failed', e);
      // TEMP DEBUG (go-live): surface Stripe's actual message to diagnose the
      // 502. Revert to the generic message once payments are confirmed working.
      return errJson('Payment error: ' + (e?.message || 'unknown error'), 502);
    }
  }

  // Persist order.
  await putOrder(order, env);

  // If a signed-in customer placed this order, save the address + the email
  // and phone they entered to their profile for next-time prefill. Also
  // persist any stripeCustomerId we created during this order so the next
  // saved-card flow finds it. Best-effort: never block the order response.
  try {
    if (storedCustomer) {
      updateContactDetails(storedCustomer, { email, phone });
      if (address) upsertAddress(storedCustomer, address);
      storedCustomer.lastOrderAt = createdAt;
      await putCustomer(storedCustomer, env);
    }
  } catch (e) {
    console.warn('saving customer profile from order failed', e);
  }

  // Reserve a slot (best-effort).
  if (schedule !== 'asap') {
    await incrSlotCount(schedule, env);
  }

  // No customer email until the kitchen accepts the order. Marketing opt-ins
  // are still recorded immediately for cash orders (card orders go through
  // the Stripe webhook).
  if (paymentMethod !== 'card') {
    await recordIfOptedIn(order, env);
  }

  return Response.json({
    orderId: id,
    clientSecret: order.payment.clientSecret || null,
    status: order.status,
    // For card orders the client needs to know what state the PI is in so
    // it can pick the right confirmation flow:
    //   succeeded         -> redirect to /thank-you immediately
    //   requires_action   -> finish 3DS with stripe.handleNextAction
    //   requires_confirmation / requires_payment_method -> normal flow
    //     (Stripe Elements confirmPayment, or confirmCardPayment for a
    //     saved card)
    piStatus: order.payment?.piStatus || null,
  });
};

async function recordIfOptedIn(order, env) {
  if (order.marketing.email) {
    await recordOptIn({ kind: 'email', value: order.customer.email, source: 'checkout' }, env);
  }
  if (order.marketing.sms) {
    await recordOptIn({ kind: 'sms', value: order.customer.phone, source: 'checkout' }, env);
  }
}

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
