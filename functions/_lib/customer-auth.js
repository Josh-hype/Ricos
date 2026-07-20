/* Customer auth: password hashing (PBKDF2) + HMAC-signed session cookie.

   Mirrors the staff auth pattern in ./auth.js but persists user records to
   CUSTOMERS_KV and stores who the session belongs to inside the cookie. */

import { normalisePhoneE164UK } from './sms.js';
import { getCustomer } from './customer.js';

const SESSION_COOKIE = 'cu';
const SESSION_TTL_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

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
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
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

// Email gets lowercased; phone gets E.164'd to +44...; anything else returns
// null so signup/signin can reject it. The returned string IS the KV key
// suffix (after `customer:`).
export function normaliseContact(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    const lower = trimmed.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower)) return null;
    return { value: lower, type: 'email' };
  }
  const phone = normalisePhoneE164UK(trimmed);
  if (!phone) return null;
  return { value: phone, type: 'phone' };
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return {
    salt: bytesToHex(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: bytesToHex(hash),
  };
}

export async function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash || !record?.iterations) return false;
  const salt = hexToBytes(record.salt);
  const computed = new Uint8Array(await pbkdf2(password, salt, record.iterations));
  return timingSafeEqualBytes(computed, hexToBytes(record.hash));
}

async function pbkdf2(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    HASH_BYTES * 8,
  );
}

function timingSafeEqualBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let r = 0;
  for (let i = 0; i < a.byteLength; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export async function makeCustomerSession(customer, env) {
  const exp = Date.now() + SESSION_TTL_DAYS * 86400 * 1000;
  // Bind the session to the current password-hash fingerprint so a password
  // reset invalidates every other outstanding session for the account.
  const payload = b64url(enc.encode(JSON.stringify({
    c: customer.contact, fp: (customer.hash || '').slice(0, 16), exp,
  })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

// Verify a raw customer session token ("<payload>.<sig>") and return
// { contact } or null. Shared by the cookie path (web) and the Bearer path
// (the customer app).
export async function verifyCustomerToken(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  if (!(await verify(payload, sig, env.SESSION_SECRET))) return null;
  try {
    const { c, fp, exp, r } = JSON.parse(dec.decode(b64urlDecode(payload)));
    // Password-RESET tokens (r:1) share this payload shape and are emailed to
    // the customer — they must never act as a session.
    if (r) return null;
    if (Date.now() > exp) return null;
    // Reject if the password changed since the session was issued (fp no longer
    // matches) or the token predates fp (legacy) — a reset logs out all other
    // devices. Costs one KV read per authenticated request.
    const customer = await getCustomer(c, env);
    if (!customer || !fp || (customer.hash || '').slice(0, 16) !== fp) return null;
    return { contact: c };
  } catch { return null; }
}

export async function readCustomerSession(cookieHeader, env) {
  if (!cookieHeader || !env.SESSION_SECRET) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  return verifyCustomerToken(m[1], env);
}

// Resolve the customer session from EITHER the cu cookie (web) OR an
// Authorization: Bearer token (the customer app, whose WebView origin is not
// the shop domain so the SameSite=Lax cookie is never sent). Same signed token
// either way, so the app path is no weaker than the web — mirrors the staff
// resolveSession() in ./auth.js.
export async function resolveCustomerSession(request, env) {
  const fromCookie = await readCustomerSession(request.headers.get('Cookie'), env);
  if (fromCookie) return fromCookie;
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyCustomerToken(m[1].trim(), env);
}

export function customerCookieHeader(token) {
  const maxAge = SESSION_TTL_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCustomerCookieHeader() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

const RESET_TTL_MS = 60 * 60 * 1000;

// Reset tokens are HMAC-signed with SESSION_SECRET and bind to the current
// password's hash fingerprint, so a token stops working the moment the
// password is changed (single-use without needing KV state). They also
// expire after RESET_TTL_MS.
export async function makeResetToken(customer, env) {
  // r:1 marks this as a RESET token so it can never verify as a session
  // (verifyCustomerToken rejects r) and a session can never verify as a
  // reset token (verifyResetToken requires r).
  const payload = b64url(enc.encode(JSON.stringify({
    c: customer.contact,
    fp: customer.hash.slice(0, 16),
    exp: Date.now() + RESET_TTL_MS,
    r: 1,
  })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

export async function verifyResetToken(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  if (!(await verify(payload, sig, env.SESSION_SECRET))) return null;
  try {
    const { c, fp, exp, r } = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (r !== 1) return null; // a session token must not reset passwords
    if (!c || !fp || !exp) return null;
    if (Date.now() > exp) return null;
    return { contact: c, fp };
  } catch { return null; }
}
