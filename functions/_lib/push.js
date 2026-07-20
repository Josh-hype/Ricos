/* FCM push sender (HTTP v1) for the customer ordering apps.

   One Firebase project serves every shop's customer app (each app is a
   separate Firebase "app" inside it); every shop's Cloudflare Pages project
   sets the SAME secret:

     FCM_SERVICE_ACCOUNT_JSON — the Firebase service-account key JSON
                                (project_id + client_email + private_key).

   iOS delivery also goes through FCM (the restaurant's APNs key is uploaded
   to the Firebase iOS app once, in the console) so this code is identical
   for both platforms.

   Best-effort by design: callers wrap sends in try/catch — a push must never
   block or fail an order flow (same stance as the Resend emails). */

const OAUTH_CACHE_KEY = 'fcm:oauth';
const OAUTH_CACHE_TTL_S = 50 * 60; // Google access tokens live 60 min; refresh at 50

const enc = new TextEncoder();

function b64urlBytes(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlString(s) {
  return b64urlBytes(enc.encode(s));
}

export function pushEnabled(env) {
  return !!env.FCM_SERVICE_ACCOUNT_JSON;
}

function serviceAccount(env) {
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is missing client_email/private_key/project_id');
  }
  return sa;
}

// PEM PKCS#8 private key -> CryptoKey for RS256 signing.
async function importPrivateKey(pem) {
  const raw = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

// Mint (or reuse from KV) a Google OAuth access token for the FCM scope.
// Cached in MARKETING_KV — present on every shop project; skipping the cache
// (namespace unbound) still works, it just signs a fresh JWT per send.
async function getAccessToken(env) {
  const kv = env.MARKETING_KV;
  if (kv) {
    const cached = await kv.get(OAUTH_CACHE_KEY);
    if (cached) return cached;
  }

  const sa = serviceAccount(env);
  const iat = Math.floor(Date.now() / 1000);
  const header = b64urlString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlString(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = b64urlBytes(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`FCM oauth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('FCM oauth returned no access_token');

  if (kv) {
    try { await kv.put(OAUTH_CACHE_KEY, data.access_token, { expirationTtl: OAUTH_CACHE_TTL_S }); }
    catch (e) { console.warn('caching FCM token failed', e); }
  }
  return data.access_token;
}

/* Send one notification to one device token.
   Returns { ok:true } or { ok:false, gone?:true } — `gone` means the token is
   dead (uninstalled app) and the caller may drop it. Throws on config errors. */
export async function sendPush({ token, title, body, data }, env) {
  const sa = serviceAccount(env);
  const accessToken = await getAccessToken(env);

  // FCM data values must be strings.
  const dataStr = {};
  for (const [k, v] of Object.entries(data || {})) dataStr[k] = String(v);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: dataStr,
        android: { priority: 'HIGH' },
        apns: { headers: { 'apns-priority': '10' } },
      },
    }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  // 404/UNREGISTERED = the device token is no longer valid (app uninstalled).
  if (res.status === 404 || text.includes('UNREGISTERED')) return { ok: false, gone: true };
  console.warn('FCM send failed', res.status, text);
  return { ok: false };
}

/* Order-status push: sends to the device token registered for the order —
   either inline (the shim attaches it to POST /api/order for repeat orders)
   or under the push:<orderId> side key (written by POST /api/order/:id/push
   from the thank-you screen; a side key so a customer request can never
   rewrite the order record). No-op when there's no token or push isn't
   configured — web orders are entirely unaffected. */
export async function sendOrderPush(order, { title, body }, env) {
  if (!pushEnabled(env) || !order?.id) return;
  let token = order.push?.token;
  let fromSideKey = false;
  if (!token && env.ORDERS_KV) {
    try {
      const raw = await env.ORDERS_KV.get(`push:${order.id}`);
      if (raw) { token = JSON.parse(raw).token; fromSideKey = true; }
    } catch (e) { /* malformed side key — treat as no token */ }
  }
  if (!token) return;
  const res = await sendPush({ token, title, body, data: { orderId: order.id } }, env);
  if (res?.gone && fromSideKey) {
    try { await env.ORDERS_KV.delete(`push:${order.id}`); } catch (e) {}
  }
}
