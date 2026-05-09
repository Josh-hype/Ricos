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
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: opts.method || 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    },
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

export async function createPaymentIntent({ amountP, currency, orderId, customerEmail }, env) {
  return call('/payment_intents', {
    amount: amountP,
    currency,
    automatic_payment_methods: { enabled: true },
    receipt_email: customerEmail || undefined,
    metadata: { orderId },
  }, env, { idempotencyKey: `pi_${orderId}` });
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
