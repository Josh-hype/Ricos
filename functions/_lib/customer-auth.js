/* Customer auth: password hashing (PBKDF2) + HMAC-signed session cookie.

   Mirrors the staff auth pattern in ./auth.js but persists user records to
   CUSTOMERS_KV and stores who the session belongs to inside the cookie. */

import { normalisePhoneE164UK } from './sms.js';

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

export async function makeCustomerSession(contact, env) {
  const exp = Date.now() + SESSION_TTL_DAYS * 86400 * 1000;
  const payload = b64url(enc.encode(JSON.stringify({ c: contact, exp })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

export async function readCustomerSession(cookieHeader, env) {
  if (!cookieHeader || !env.SESSION_SECRET) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  if (!(await verify(payload, sig, env.SESSION_SECRET))) return null;
  try {
    const { c, exp } = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (Date.now() > exp) return null;
    return { contact: c };
  } catch { return null; }
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
  const payload = b64url(enc.encode(JSON.stringify({
    c: customer.contact,
    fp: customer.hash.slice(0, 16),
    exp: Date.now() + RESET_TTL_MS,
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
    const { c, fp, exp } = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (!c || !fp || !exp) return null;
    if (Date.now() > exp) return null;
    return { contact: c, fp };
  } catch { return null; }
}
