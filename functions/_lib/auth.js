/* Staff auth: HMAC-signed session cookie. PIN is stored as a SHA-256 hash
   in env.STAFF_PIN_HASH. The session cookie carries an expiry and is signed
   with env.SESSION_SECRET. Stateless, no KV lookup needed.

   A second, parallel session ('rsm') gates the financial views (Today's
   summary, Z report). It's verified against env.MANAGER_PIN_HASH and exists
   only when that variable is set — shops without manager protection
   configured behave exactly as before. */

const SESSION_COOKIE = 'rs';
const MANAGER_COOKIE = 'rsm';
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

export async function checkManagerPin(pin, env) {
  if (!env.MANAGER_PIN_HASH) return false;
  const h = await sha256Hex(String(pin));
  return timingSafeEqual(h, env.MANAGER_PIN_HASH.toLowerCase());
}

// Manager protection is opt-in: a shop that hasn't configured a manager PIN
// keeps the existing behaviour (any staff PIN can view the figures).
export function managerEnabled(env) {
  return !!(env.MANAGER_PIN_HASH && env.MANAGER_PIN_HASH.length > 0);
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

export async function makeManagerSession(env) {
  const exp = Date.now() + SESSION_TTL_HOURS * 3600 * 1000;
  const payload = b64url(enc.encode(JSON.stringify({ exp, scope: 'manager' })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

export async function readManagerSession(cookieHeader, env) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${MANAGER_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const ok = await verify(payload, sig, env.SESSION_SECRET);
  if (!ok) return null;
  try {
    const { exp, scope } = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (scope !== 'manager') return null;
    if (Date.now() > exp) return null;
    return { exp };
  } catch { return null; }
}

export function managerSessionCookieHeader(token) {
  const maxAge = SESSION_TTL_HOURS * 3600;
  return `${MANAGER_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearManagerCookieHeader() {
  return `${MANAGER_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
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

// Returns null when allowed (no manager PIN configured for the shop, or a
// valid manager session present), or a 403 Response when locked. Caller is
// responsible for requireStaff first.
export async function requireManager(request, env) {
  if (!managerEnabled(env)) return null;
  const session = await readManagerSession(request.headers.get('Cookie'), env);
  if (session) return null;
  return new Response(JSON.stringify({ error: 'manager-locked' }), {
    status: 403, headers: { 'Content-Type': 'application/json' }
  });
}
