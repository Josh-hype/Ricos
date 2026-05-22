/* POST /api/order — create an order.

   For card orders we create a Stripe PaymentIntent and return its
   clientSecret. The order is stored with status='pending_payment' and gets
   promoted to 'pending_accept' by the Stripe webhook on success.

   For cash orders we store the order immediately with status='pending_accept'
   and send the customer their first confirmation email. */

import { getConfig } from '../_lib/config.js';
import { computeTotals } from '../_lib/totals.js';
import { validateDeliveryPostcode } from '../_lib/postcode.js';
import { isOpenNow, isSlotValid, listSlots } from '../_lib/hours.js';
import { createPaymentIntent } from '../_lib/stripe.js';
import { putOrder, newOrderId, recordOptIn, incrSlotCount } from '../_lib/kv.js';
import { normalisePhoneE164UK } from '../_lib/sms.js';
import { readCustomerSession } from '../_lib/customer-auth.js';
import { getCustomer, putCustomer, upsertAddress, updateContactDetails } from '../_lib/customer.js';

export const onRequestPost = async ({ request, env }) => {
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
  if (fulfillment === 'delivery') {
    if (!config.fulfillment.delivery.enabled) return errJson('Delivery is not available right now.', 400);
    const pc = validateDeliveryPostcode(
      input.deliveryAddress?.postcode,
      config.fulfillment.delivery.allowedOutcodes,
      config.fulfillment.delivery.areaDescription,
    );
    if (!pc.ok) return errJson(pc.reason, 400);
    const line1 = (input.deliveryAddress?.line1 || '').trim();
    if (line1.length < 2) return errJson('Please enter your delivery address.', 400);
    address = {
      line1,
      line2: (input.deliveryAddress?.line2 || '').trim(),
      city: config.business.address.city,
      postcode: pc.postcode,
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
  const totals = computeTotals(input, config);
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

  // Card flow: create PaymentIntent on the venue's connected Stripe
  // account (Stripe Connect direct charge). The platform retains the
  // service fee via application_fee_amount.
  if (paymentMethod === 'card') {
    const connectedAccountId = config.stripe?.connectedAccountId;
    if (!connectedAccountId || connectedAccountId === 'TBD') {
      return errJson('Card payments are not configured yet. Please choose cash, or contact us.', 503);
    }
    try {
      const pi = await createPaymentIntent({
        amountP: totals.totalP,
        currency: 'gbp',
        orderId: id,
        customerEmail: email,
        connectedAccountId,
        applicationFeeP: totals.serviceFeeP || 0,
      }, env);
      order.payment.intentId = pi.id;
      order.payment.clientSecret = pi.client_secret;
      order.payment.connectedAccountId = connectedAccountId;
    } catch (e) {
      console.error('Stripe PI failed', e);
      return errJson('Payment service unavailable — please try again.', 502);
    }
  }

  // Persist order.
  await putOrder(order, env);

  // If a signed-in customer placed this order, save the address + the email
  // and phone they entered to their profile for next-time prefill.
  // Best-effort: never block the order response on this.
  try {
    const session = await readCustomerSession(request.headers.get('Cookie'), env);
    if (session) {
      const customer = await getCustomer(session.contact, env);
      if (customer) {
        updateContactDetails(customer, { email, phone });
        if (address) upsertAddress(customer, address);
        customer.lastOrderAt = createdAt;
        await putCustomer(customer, env);
      }
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
