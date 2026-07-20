/* POST /api/order — create an order.

   For card orders we create a Stripe PaymentIntent and return its
   clientSecret. The order is stored with status='pending_payment' and gets
   promoted to 'pending_accept' by the Stripe webhook on success.

   For cash orders we store the order immediately with status='pending_accept'
   and send the customer their first confirmation email. */

import { getConfig } from '../_lib/config.js';
import { computeTotals } from '../_lib/totals.js';
import { resolveMenu } from '../_lib/menu-store.js';
import { resolveDelivery } from '../_lib/delivery.js';
import { isOpenNow, isSlotValid, listSlots, deliveryLateStart, activeClosure } from '../_lib/hours.js';
import { createPaymentIntent, createCustomer } from '../_lib/stripe.js';
import { putOrder, newOrderId, nextOrderNumber, recordOptIn, incrSlotCount, getSlotCount } from '../_lib/kv.js';
import { getOffMap } from '../_lib/availability.js';
import { getOrderingPause } from '../_lib/ordering-pause.js';
import { normalisePhoneE164UK } from '../_lib/sms.js';
import { resolveCustomerSession } from '../_lib/customer-auth.js';
import { getCustomer, putCustomer, upsertAddress, updateContactDetails } from '../_lib/customer.js';
import { makeOrderStatusToken } from '../_lib/order-token.js';
import { rateLimit } from '../_lib/rate-limit.js';

export const onRequestPost = async ({ request, env }) => {
  // Generous per-IP cap (totals are recomputed server-side, so this is abuse
  // damping, not a correctness control). 429s long before a card is charged.
  const limited = await rateLimit(env, 'order', request, 20);
  if (limited) return limited;

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid JSON', 400); }

  const config = getConfig();

  // Emergency one-off closure ("we're closed today") — takes online ordering fully
  // offline for the day. Authoritative; the order page also shows it + disables checkout.
  {
    const closure = activeClosure(config);
    if (closure) return errJson(closure.message, 503);
  }

  // Back-office "pause online ordering" toggle — staff stopped taking online orders
  // for the rest of today. Authoritative (the order page also shows a banner +
  // disables checkout); counter/till sales are unaffected.
  {
    const pause = await getOrderingPause(env);
    if (pause.paused) {
      return errJson("We've paused online orders for now — please check back a little later, or call the shop to order.", 503);
    }
  }

  // Customer fields. Strip control characters from the free-text name — it flows
  // into the kitchen receipt (ESC/POS) and confirmation emails, so a crafted name
  // must not carry control bytes — and cap its length.
  const name = (input.customer?.name || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 60);
  const email = (input.customer?.email || '').trim().toLowerCase();
  const phoneRaw = (input.customer?.phone || '').trim();
  const phone = normalisePhoneE164UK(phoneRaw);
  if (name.length < 2) return errJson('Please enter your name.', 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errJson('Please enter a valid email.', 400);
  if (!phone) return errJson('Please enter a UK mobile number.', 400);

  // Fulfillment.
  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'collection';
  // Collection can be switched off too (till-only venues take no online orders
  // at all). delivery.enabled is enforced below where delivery is chosen; this
  // is the missing half of the same config contract. Gated on an explicit
  // false so existing shops (enabled:true or absent) are untouched.
  if (fulfillment === 'collection' && config.fulfillment?.collection?.enabled === false) {
    return errJson('Online ordering is not available.', 400);
  }
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
  } else if (config.fulfillment?.collection?.collectAddress === true) {
    // Config-gated: some shops want the customer's address on COLLECTION
    // orders too (Mega Chippy asked for it). Required — enforced here so the
    // checkout can't be bypassed. Other shops (flag absent) are untouched.
    const line1 = (input.deliveryAddress?.line1 || '').trim();
    const compact = (input.deliveryAddress?.postcode || '').trim().toUpperCase().replace(/\s+/g, '');
    if (line1.length < 2) return errJson('Please enter your address.', 400);
    if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(compact)) return errJson('Please enter a valid postcode.', 400);
    const postcode = compact.replace(/^(.*)([0-9][A-Z]{2})$/, '$1 $2'); // canonical "YO24 3AQ" spacing
    address = {
      line1,
      line2: (input.deliveryAddress?.line2 || '').trim(),
      city: config.business.address.city,
      postcode,
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

  // A scheduled (advance) order must not land on a one-off closed day. The
  // same-day closure is already enforced at the top; this covers a customer
  // pre-ordering for a FUTURE date the shop has declared closed. ASAP can't hit
  // a future closure, and if today were closed we'd have returned above.
  if (schedule !== 'asap') {
    const schedClosure = activeClosure(config, new Date(schedule));
    if (schedClosure) return errJson(schedClosure.message, 400);
  }

  // Capacity: enforce maxOrdersPerSlot so a time slot can't be over-booked.
  // Best-effort — KV has no compare-and-swap, so a rare simultaneous pair could
  // still slip through, but this closes the everyday over-booking gap that the
  // (previously unenforced) maxOrdersPerSlot config implied was handled.
  if (schedule !== 'asap') {
    const cap = Number(config.ordering?.scheduling?.maxOrdersPerSlot) || 0;
    if (cap > 0 && (await getSlotCount(schedule, env)) >= cap) {
      return errJson('Sorry, that time slot is fully booked — please pick another time.', 400);
    }
  }

  // TEMPORARY date-bounded delivery late-start (config fulfillment.delivery.lateStart):
  // on listed dates, delivery is only offered from a set time. Enforced on the ACTUAL
  // fulfillment moment — now for ASAP, else the chosen slot — so an early slot can't slip
  // through. Collection is never affected; a no-op for every other date/shop.
  if (fulfillment === 'delivery') {
    const when = schedule === 'asap' ? new Date() : new Date(schedule);
    const ls = deliveryLateStart(config, when);
    if (!ls.ok) {
      return errJson(`Delivery isn't available before ${to12h(ls.from)} on the day you've selected. Please pick a delivery time from ${to12h(ls.from)}, or switch to collection.`, 400);
    }
  }

  // Sold-out enforcement: reject any line a staff member has "86'd" (turned off
  // when out of stock). Authoritative — the order page also greys these out, but
  // the client is never trusted. A no-op when nothing is off.
  {
    const offMap = await getOffMap(env);
    const offLine = (input.items || []).find((l) => l && l.id && offMap[l.id]);
    if (offLine) {
      const nm = offMap[offLine.id]?.name || 'An item in your cart';
      return errJson(`Sorry, ${nm} has just sold out. Please remove it from your cart and try again.`, 400);
    }
  }

  // Resolve the signed-in customer (if any) BEFORE totals: the first-orders
  // promo is per-customer, so we need their redemption count to decide the
  // discount before it's baked into the total (and the Stripe amount).
  let session = null;
  let storedCustomer = null;
  try {
    session = await resolveCustomerSession(request, env); // cookie (web) or Bearer (customer app)
    if (session) storedCustomer = await getCustomer(session.contact, env);
  } catch (e) {
    console.warn('reading session failed', e);
  }

  // First-orders welcome promo: a signed-in customer gets X% off their first N
  // orders. Enforced server-side (never trust the client for a discount) and
  // gated on config + the customer's redemption count. Guests/walk-ins never
  // qualify — there's no account to meter against.
  let firstOrderDiscount = null;
  {
    const fo = config.promo?.firstOrders;
    if (fo?.enabled && storedCustomer) {
      const limit = Math.max(0, Number(fo.limit) || 0);
      const used = Number(storedCustomer.promoOrdersUsed) || 0;
      if (limit > 0 && used < limit) {
        firstOrderDiscount = {
          percent: Math.max(0, Math.min(100, Number(fo.percent) || 0)),
          label: fo.label || `${Number(fo.percent) || 0}% off — first ${limit} orders`,
        };
      }
    }
  }

  // Totals (server-side; client never trusted for prices). resolveMenu applies
  // any owner-edited menu from KV, falling back to the static build-time menu.
  const menu = await resolveMenu(env);
  const totals = computeTotals(input, config, { deliveryFeeP, menu, firstOrderDiscount });
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

  // Customer-app push registration (order-scoped, so it works for guests too):
  // the app sends its FCM device token with the order and the kitchen's
  // accept/ready/cancel transitions push to it. Transactional-only — nothing
  // here opts the customer into marketing. Web orders never carry this field.
  {
    const pushToken = typeof input.push?.token === 'string' ? input.push.token.trim() : '';
    if (pushToken && pushToken.length <= 512) {
      order.push = { token: pushToken, platform: input.push.platform === 'ios' ? 'ios' : 'android' };
    }
  }

  // (storedCustomer was resolved above, before totals, for the first-orders promo.)

  // Record that this order carried the first-orders promo, so the redemption is
  // counted exactly once when the order is actually placed: now for cash (below),
  // or on payment success in markOrderPaid for card (so an abandoned card payment
  // doesn't burn a redemption). `contact` lets the webhook find the customer.
  if (firstOrderDiscount && storedCustomer && totals.discountP > 0) {
    order.promo = { firstOrders: true, contact: storedCustomer.contact, counted: false };
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

    // Only attach the stored Stripe Customer when actually saving a card or
    // paying with a saved one. A plain new-card payment must NOT carry a
    // customer — a stale/test-mode cus_ id would otherwise break the live
    // PaymentIntent — so a signed-in new-card order behaves like a guest one.
    const piParamsFor = (custId) => ({
      amountP: totals.totalP,
      currency: 'gbp',
      orderId: id,
      customerEmail: email,
      connectedAccountId,
      applicationFeeP: totals.serviceFeePlatformP || 0,  // Lumin Labs' cut; the rest of the service charge stays with the venue
      customerId: (saveCard || paymentMethodIdInput) ? (custId || undefined) : undefined,
      setupFutureUsage: saveCard && custId ? 'off_session' : undefined,
      paymentMethodId: paymentMethodIdInput || undefined,
      requireCvcRecollection,
    });

    try {
      let pi;
      try {
        pi = await createPaymentIntent(piParamsFor(stripeCustomerId), env);
      } catch (e) {
        // A stored Stripe Customer can be stale — e.g. created in test mode and
        // gone from the now-live connected account. When saving a new card we
        // self-heal: create a fresh customer and retry once (also repairing the
        // customer's KV record for next time). A saved-card payment can't be
        // recovered — the card lived on the missing customer — so surface a
        // clear message asking for a new card.
        const missingCustomer = e?.stripe?.code === 'resource_missing' && e?.stripe?.param === 'customer';
        if (missingCustomer && saveCard && !paymentMethodIdInput && storedCustomer) {
          const fresh = await createCustomer({
            email, name, phone,
            metadata: { app_customer_id: storedCustomer.id, app_contact: storedCustomer.contact },
          }, connectedAccountId, env);
          stripeCustomerId = fresh.id;
          storedCustomer.stripeCustomerId = stripeCustomerId;
          pi = await createPaymentIntent(piParamsFor(stripeCustomerId), env);
        } else if (missingCustomer && paymentMethodIdInput) {
          return errJson('That saved card is no longer available. Please pay with a new card.', 402);
        } else {
          throw e;
        }
      }
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
      return errJson('Payment service unavailable — please try again.', 502);
    }
  }

  // Assign the short memorable order number (reference stays `id`), then persist.
  order.orderNumber = await nextOrderNumber(env);
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
      // Cash orders are placed immediately (pending_accept), so count the
      // first-orders redemption now. Card orders wait for payment success
      // (markOrderPaid) so an abandoned payment doesn't consume a redemption.
      if (order.promo?.firstOrders && paymentMethod !== 'card' && !order.promo.counted) {
        storedCustomer.promoOrdersUsed = (Number(storedCustomer.promoOrdersUsed) || 0) + 1;
        order.promo.counted = true;
        await putOrder(order, env);
      }
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
    orderNumber: order.orderNumber,
    clientSecret: order.payment.clientSecret || null,
    status: order.status,
    // Capability token for GET /api/order/:id/status (live tracking in the
    // customer app's thank-you screen). Harmless extra field for the web.
    statusToken: await makeOrderStatusToken(id, env),
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

// "16:30" -> "4:30pm" for customer-facing messages.
function to12h(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m || 0).padStart(2, '0')}${ap}`;
}

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
