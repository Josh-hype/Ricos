/* Staff auth: HMAC-signed session cookie. PIN is stored as a SHA-256 hash
   in env.STAFF_PIN_HASH. The session cookie carries an expiry and is signed
   with env.SESSION_SECRET. Stateless, no KV lookup needed. */

const SESSION_COOKIE = 'rs';
const SESSION_TTL_HOURS = 12;

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

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function sign(payload, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64url(sig);
}

async function verify(payload, sig, secret) {
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(payload));
}

export async function checkPin(pin, env) {
  if (!env.STAFF_PIN_HASH) return false;
  const h = await sha256Hex(String(pin));
  return timingSafeEqual(h, env.STAFF_PIN_HASH.toLowerCase());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function makeSession(env) {
  const exp = Date.now() + SESSION_TTL_HOURS * 3600 * 1000;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

export async function readSession(cookieHeader, env) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const ok = await verify(payload, sig, env.SESSION_SECRET);
  if (!ok) return null;
  try {
    const { exp } = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (Date.now() > exp) return null;
    return { exp };
  } catch { return null; }
}

export function sessionCookieHeader(token) {
  const maxAge = SESSION_TTL_HOURS * 3600;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function requireStaff(request, env) {
  const session = await readSession(request.headers.get('Cookie'), env);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  return null;
}
