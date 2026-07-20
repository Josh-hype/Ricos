/* Order status tokens — HMAC-signed capability tokens that let the customer
   who just placed an order poll its status without an account. Minted by
   POST /api/order (returned as `statusToken`), checked by
   GET /api/order/:id/status.

   The payload carries scope:'order-status' so this token can never be
   mistaken for any other credential signed with SESSION_SECRET: staff
   resolveSession() rejects tokens with a scope, customer session/reset
   verification requires claims this token doesn't have. */

const TTL_MS = 48 * 3600 * 1000; // long enough to track tonight's order, no longer

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function makeOrderStatusToken(orderId, env) {
  if (!env.SESSION_SECRET || !orderId) return null;
  const payload = b64url(enc.encode(JSON.stringify({
    o: orderId,
    exp: Date.now() + TTL_MS,
    scope: 'order-status',
  })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function verifyOrderStatusToken(token, orderId, env) {
  if (!token || !orderId || !env.SESSION_SECRET) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.SESSION_SECRET), b64urlDecode(sig), enc.encode(payload)
    );
    if (!ok) return false;
    const d = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (d.scope !== 'order-status') return false;
    if (d.o !== orderId) return false;
    if (Date.now() > d.exp) return false;
    return true;
  } catch { return false; }
}
