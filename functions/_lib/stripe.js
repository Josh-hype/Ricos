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
  cardPresent,
  captureMethod,
  idempotencyKey,
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
  if (cardPresent) {
    // In-person card via Terminal (e.g. WisePOS E). Cart sales authorise now and capture
    // after /counter-order re-verifies the amount (manual). A manual "quick charge"
    // (staff types the amount) has nothing to re-verify, so it captures immediately.
    body.payment_method_types = ['card_present'];
    body.capture_method = captureMethod || 'manual';
  } else if (paymentMethodId) {
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
  const opts = { idempotencyKey: idempotencyKey || `pi_${orderId}` };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/payment_intents', body, env, opts);
}

/* Create a hosted Stripe Checkout Session for "pay by link".
   Staff start an order on the till and we text the customer this session's URL;
   the customer pays on Stripe's hosted page on their own phone. Like the rest of
   the payment flow this is a Connect DIRECT charge — the session (and the
   PaymentIntent it creates) live on the venue's connected account, money settles
   to the venue, and the platform keeps application_fee_amount.

   The single line item is the already-computed order total (server-authoritative).
   metadata.orderId is set on BOTH the session and the PaymentIntent (via
   payment_intent_data) so the existing payment_intent.succeeded webhook promotes
   the order to the kitchen the moment the customer pays — no new webhook handler. */
export async function createCheckoutSession({
  amountP,
  currency,
  orderId,
  description,
  customerEmail,
  connectedAccountId,
  applicationFeeP,
  successUrl,
  cancelUrl,
  expiresAt,
  idempotencyKey,
}, env) {
  const body = {
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        product_data: { name: description || 'Order' },
        unit_amount: amountP,
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orderId },
    // Stamp the orderId onto the PaymentIntent the session creates, so the
    // payment_intent.succeeded webhook can find this order by metadata.orderId.
    payment_intent_data: { metadata: { orderId } },
  };
  if (customerEmail) body.customer_email = customerEmail;
  if (expiresAt) body.expires_at = expiresAt;
  if (connectedAccountId && applicationFeeP) {
    body.payment_intent_data.application_fee_amount = applicationFeeP;
  }
  const opts = { idempotencyKey: idempotencyKey || `cs_${orderId}` };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/checkout/sessions', body, env, opts);
}

/* Stripe Terminal — server-driven readers (e.g. BBPOS WisePOS E). All calls run on
   the shop's connected account (direct charges), like the rest of the payment flow.
   The till never touches the Terminal SDK: the backend tells the reader to collect,
   polls its action, then captures the authorised PaymentIntent. */

// List readers on the connected account (used to find the online counter reader).
export async function listTerminalReaders(connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/terminal/readers?limit=100', null, env, opts);
}

// Retrieve one reader — its `action` reports the in-progress collection
// (status: in_progress | succeeded | failed) which the till polls.
export async function retrieveTerminalReader(readerId, connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/terminal/readers/${encodeURIComponent(readerId)}`, null, env, opts);
}

// Tell the reader to collect + authorise a card_present PaymentIntent.
export async function processPaymentIntentOnReader(readerId, paymentIntentId, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/terminal/readers/${encodeURIComponent(readerId)}/process_payment_intent`, { payment_intent: paymentIntentId }, env, opts);
}

// Abort whatever the reader is currently doing (the till's Cancel button).
export async function cancelReaderAction(readerId, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`, {}, env, opts);
}

/* Terminal provisioning (one-time reader setup). A reader must belong to a Terminal
   Location on the connected account; we reuse one if it exists, else create it. */
export async function listTerminalLocations(connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/terminal/locations?limit=100', null, env, opts);
}
export async function createTerminalLocation(displayName, address, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/terminal/locations', { display_name: displayName, address }, env, opts);
}
// Register a physical reader from the 3-word code shown on its screen.
export async function registerTerminalReader({ registrationCode, label, location }, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  const body = { registration_code: registrationCode };
  if (label) body.label = label;
  if (location) body.location = location;
  return call('/terminal/readers', body, env, opts);
}

/* Reader branding — upload an image to Stripe Files (multipart, on the connected
   account) and point a Terminal Configuration's splash screen at it, set as the
   account default so the shop's readers show its logo when idle (instead of Stripe). */
export async function uploadTerminalSplash(blob, filename, connectedAccountId, env) {
  const fd = new FormData();
  fd.append('purpose', 'terminal_reader_splashscreen');
  fd.append('file', blob, filename || 'logo.png');
  const headers = { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (connectedAccountId) headers['Stripe-Account'] = connectedAccountId; // file lives on the shop's account
  const res = await fetch('https://files.stripe.com/v1/files', { method: 'POST', headers, body: fd });
  const json = await res.json();
  if (!res.ok) { const e = new Error(json?.error?.message || `Stripe files ${res.status}`); e.stripe = json?.error; throw e; }
  return json; // { id: 'file_...' }
}
export async function createTerminalConfiguration({ splashscreenFileId }, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  const body = {};
  if (splashscreenFileId) body.bbpos_wisepos_e = { splashscreen: splashscreenFileId };
  return call('/terminal/configurations', body, env, opts);
}
// Apply a configuration to a location (readers there adopt it). Used to push the splash
// logo without `is_account_default`, which older account API versions reject.
export async function updateTerminalLocation(locationId, fields, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/terminal/locations/${encodeURIComponent(locationId)}`, fields, env, opts);
}

// Capture an authorised (requires_capture) PaymentIntent — full amount.
export async function capturePaymentIntent(paymentIntentId, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {}, env, opts);
}

// Cancel a PaymentIntent (e.g. the customer walked away before tapping).
export async function cancelPaymentIntent(paymentIntentId, connectedAccountId, env) {
  const opts = {};
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, env, opts);
}

/* Refund a PaymentIntent in full on the connected account. For Connect direct
   charges, refund_application_fee returns the platform's application fee to the
   connected account too — used when an order is rejected so the platform keeps
   nothing. Idempotent per PaymentIntent, so a retry can't double-refund. */
export async function createRefund({ paymentIntentId, amountP, refundApplicationFee = true, idempotencyKey }, connectedAccountId, env) {
  const body = { payment_intent: paymentIntentId };
  if (amountP) body.amount = amountP;                 // partial; omit for full
  if (refundApplicationFee) body.refund_application_fee = true;
  // Idempotency key must differ per distinct refund so multiple partials on one
  // PI don't collapse into one; callers pass `refund_<pi>_<prior>_<amount>` (a
  // genuine retry of the SAME refund reuses the key, so Stripe de-dupes it).
  const opts = { idempotencyKey: idempotencyKey || `refund_${paymentIntentId}` };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call('/refunds', body, env, opts);
}

/* Retrieve a PaymentIntent (on the connected account for direct charges).
   Used to verify a payment really succeeded before promoting the order. */
export async function retrievePaymentIntent(id, connectedAccountId, env) {
  const opts = { method: 'GET' };
  if (connectedAccountId) opts.stripeAccount = connectedAccountId;
  return call(`/payment_intents/${encodeURIComponent(id)}`, null, env, opts);
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

// Constant-time hex-string comparison for the webhook HMAC (avoids the early
// exit of !==). Matches the standard the staff PIN / customer password use.
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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
  if (!timingSafeEqualHex(computed, v1)) return null;
  // Tolerance: 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
