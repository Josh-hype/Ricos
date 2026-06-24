/* Lumin Labs OWNER auth — a separate, single-owner login for the platform
   back-office, kept deliberately apart from the shops' staff/manager sessions so
   an owner cookie can never act as shop staff and vice-versa.

   Credentials (Cloudflare env on the admin project only — never in git):
     OWNER_PASSWORD_HASH  required. Keyed HMAC-SHA256 of the password:
                            printf %s "<password>" | openssl dgst -sha256 -hmac "<SESSION_SECRET>"
                          (a bare SHA-256 of the password is also accepted, so the
                           hash can be upgraded with zero downtime.)
     OWNER_USERNAME       optional. When set, the username must also match.
     SESSION_SECRET       required. Signs the session cookie + keys the hash.

   The session is a stateless HMAC-signed cookie (no KV needed), same shape as the
   staff session but with its own name + scope so the two never cross over. */

const COOKIE = 'll_owner';
const TTL_HOURS = 8;

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
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmacHex(str, secret) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(str));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sign(payload, secret) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
}
async function verify(payload, sig, secret) {
  return crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(payload));
}

// Keyed-HMAC password check with a legacy bare-SHA-256 fallback (lets the env var
// be upgraded to the stronger keyed hash without downtime).
async function verifyPasswordHash(password, storedHash, env) {
  if (!storedHash) return false;
  const stored = String(storedHash).toLowerCase();
  if (timingSafeEqual(await hmacHex(password, env.SESSION_SECRET || ''), stored)) return true;
  return timingSafeEqual(await sha256Hex(password), stored);
}

export function ownerEnabled(env) {
  return !!(env.OWNER_PASSWORD_HASH && env.SESSION_SECRET);
}

export async function checkOwner(username, password, env) {
  if (!ownerEnabled(env)) return false;
  // Username is optional: only enforced when OWNER_USERNAME is configured.
  if (env.OWNER_USERNAME) {
    if (!timingSafeEqual(String(username || '').toLowerCase(), String(env.OWNER_USERNAME).toLowerCase())) return false;
  }
  return verifyPasswordHash(String(password || ''), env.OWNER_PASSWORD_HASH, env);
}

export async function makeOwnerSession(env) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + TTL_HOURS * 3600 * 1000, scope: 'owner' })));
  return `${payload}.${await sign(payload, env.SESSION_SECRET)}`;
}

async function verifyToken(token, env) {
  if (!token) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  try {
    if (!(await verify(payload, sig, env.SESSION_SECRET))) return null;
    const d = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (d.scope !== 'owner' || Date.now() > d.exp) return null;
    return d;
  } catch { return null; }
}

export async function readOwnerSession(cookieHeader, env) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? verifyToken(m[1], env) : null;
}

export function ownerCookieHeader(token) {
  return `${COOKIE}=${token}; Max-Age=${TTL_HOURS * 3600}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export function clearOwnerCookieHeader() {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// Same-origin guard for state-changing owner routes (the owner login/logout are
// cookie-authenticated, so a SameSite=Lax cookie still rides cross-site top-level
// POSTs). Returns null when OK or a 403 Response when the Origin is cross-site.
export function csrfOriginCheck(request) {
  const method = (request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  try { if (new URL(origin).host === new URL(request.url).host) return null; } catch {}
  return new Response(JSON.stringify({ error: 'bad origin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

// Gate for every owner-only data endpoint. Returns null when authorised, else a
// JSON Response (503 when the owner login isn't configured, 401 when not logged in).
export async function requireOwner(request, env) {
  if (!ownerEnabled(env)) {
    return new Response(JSON.stringify({ error: 'owner-login-not-configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const session = await readOwnerSession(request.headers.get('Cookie'), env);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}
