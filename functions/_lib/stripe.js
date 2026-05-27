/* Thin Stripe REST wrapper. We avoid the npm SDK to keep the Worker bundle
   small. Only the endpoints we actually use are wrapped. */

const STRIPE_BASE = 'https://api.stripe.com/v1';

function form(obj, prefix = '') {
  const out = new URLSearchParams();
  function add(k, v) {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => add(`${k}[${i}]`, x));
    } else if (typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv);
    } else {
      out.append(k, String(v));
    }
  }
  for (const [k, v] of Object.entries(obj)) add(prefix ? `${prefix}[${k}]` : k, v);
  return out;
}

async function call(path, body, env, opts = {}) {
  const headers = {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  // Stripe-Account header makes this a "direct" call on the connected
  // account. Required for Connect direct charges.
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;

  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: opts.method || 'POST',
    headers,
    body: body ? form(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe ${res.status}`;
    const err = new Error(msg);
    err.stripe = json?.error;
    throw err;
  }
  return json;
}

/* Create a PaymentIntent.
   In Stripe Connect mode (connectedAccountId set), this is a "direct
   charge" — the PaymentIntent is created on the connected account, money
   settles to the venue, and the platform automatically retains the
   application_fee_amount (kept in the platform's Stripe balance).

   Optional saved-card fields:
   - customerId: attach the PI to a Stripe Customer (cus_xxx) on the
     connected account. Required for saving or charging saved cards.
   - setupFutureUsage: 'off_session' — instructs Stripe to save the new
     PaymentMethod to the customer once payment succeeds, so it can be
     charged on future orders without re-entering details.
   - paymentMethodId: pm_xxx of a saved card. When set we confirm the
     PI server-side off-session, so the customer skips Stripe Elements
     entirely (the client only handles 3DS challenges if Stripe demands
     one). */
export async function createPaymentIntent({
  amountP,
  currency,
  orderId,
  customerEmail,
  connectedAccountId,
  applicationFeeP,
  customerId,
  setupFutureUsage,
  paymentMethodId,
  requireCvcRecollection,
}, env) {
  const body = {
    amount: amountP,
    currency,
    receipt_email: customerEmail || undefined,
    metadata: { orderId },
  };
  if (connectedAccountId && applicationFeeP) {
    body.application_fee_amount = applicationFeeP;
  }
  if (customerId) body.customer = customerId;
  if (setupFutureUsage) body.setup_future_usage = setupFutureUsage;
  if (paymentMethodId) {
    // Pay with a saved card. The customer is present on the checkout page,
    // so we attach the saved PaymentMethod but DON'T confirm server-side —
    // the client confirms via stripe.confirmCardPayment, which can surface a
    // 3DS challenge when the bank requires one. (Confirming off_session here
    // would tell Stripe nobody's watching, suppressing 3DS and freezing any
    // card that needs it.) require_cvc_recollection layers a CVV re-prompt on
    // top for high-value orders.
    body.payment_method = paymentMethodId;
    if (requireCvcRecollection) {
      body.payment_method_options = { card: { require_cvc_recollection: true } };
    }
  } else {
    body.automatic_payment_methods = { enabled: true };
  }
  const opts = { idempotencyKey: `pi_${orderId}` };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/payment_intents', body, env, opts);
}

/* Refund a PaymentIntent in full on the connected account. For Connect direct
   charges, refund_application_fee returns the platform's application fee to the
   connected account too — used when an order is rejected so the platform keeps
   nothing. Idempotent per PaymentIntent, so a retry can't double-refund. */
export async function createRefund({ paymentIntentId, refundApplicationFee = true }, connectedAccountId, env) {
  const body = { payment_intent: paymentIntentId };
  if (refundApplicationFee) body.refund_application_fee = true;
  const opts = { idempotencyKey: `refund_${paymentIntentId}` };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/refunds', body, env, opts);
}

/* Create a Customer on the connected account. Used the first time a
   signed-in user opts to save a card for that shop. Customer IDs are
   per-connected-account (one shop's cus_xxx isn't usable elsewhere). */
export async function createCustomer({ email, name, phone, metadata }, connectedAccountId, env) {
  const body = {
    email: email || undefined,
    name: name || undefined,
    phone: phone || undefined,
    metadata: metadata || undefined,
  };
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/customers', body, env, opts);
}

/* List PaymentMethods (cards only) attached to a customer on the
   connected account. Returns Stripe's list response. */
export async function listPaymentMethods(customerId, connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  const qs = `?customer=${encodeURIComponent(customerId)}&type=card&limit=10`;
  return call(`/payment_methods${qs}`, null, env, opts);
}

/* Detach a PaymentMethod from its customer on the connected account. */
export async function detachPaymentMethod(paymentMethodId, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, {}, env, opts);
}

/* Payment Method Domains — register the shop's web domain so wallet buttons
   (Apple Pay / Google Pay) render in Elements. For Connect DIRECT charges this
   MUST be done on the connected account (pass connectedAccountId), not the
   platform — the Dashboard can't register domains for direct-charge accounts. */
export async function listPaymentMethodDomains(domainName, connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_method_domains?domain_name=${encodeURIComponent(domainName)}`, null, env, opts);
}
export async function createPaymentMethodDomain(domainName, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/payment_method_domains', { domain_name: domainName }, env, opts);
}
export async function validatePaymentMethodDomain(id, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_method_domains/${id}/validate`, {}, env, opts);
}

export async function verifyWebhook(rawBody, sigHeader, env) {
  if (!sigHeader || !env.STRIPE_WEBHOOK_SECRET) return null;
  const parts = Object.fromEntries(sigHeader.split(',').map(s => s.split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const computed = [...new Uint8Array(sigBuf)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (computed !== v1) return null;
  // Tolerance: 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
