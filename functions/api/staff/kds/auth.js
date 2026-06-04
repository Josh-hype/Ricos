/* POST /api/staff/kds/auth — turn this device into a Kitchen Display.
   Proves it's an authorised device with the shop's setup password (the same
   per-shop env.TILL_SETUP_PASSWORD used for till onboarding), then issues a
   long-lived, no-PIN KDS token. The display stores it and replays it as
   Authorization: Bearer on the KDS-only endpoints. */

import { makeKdsSession } from '../../../_lib/auth.js';

const enc = new TextEncoder();
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid request.' }, 400); }
  const password = String(body.password || '');

  const expected = env.TILL_SETUP_PASSWORD || '';
  if (!expected) return j({ error: 'Kitchen display setup is not configured for this shop yet.' }, 503);

  // Best-effort per-IP throttle, mirroring device-setup / login.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `kds-setup-attempts:${ip}`;
  if (env.STAFF_LOGIN_KV) {
    const n = Number(await env.STAFF_LOGIN_KV.get(key)) || 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  const ok = timingSafeEqual(await sha256Hex(password), await sha256Hex(expected));
  if (!ok) return j({ error: 'Incorrect setup password.' }, 401);

  if (env.STAFF_LOGIN_KV) await env.STAFF_LOGIN_KV.delete(key);
  const token = await makeKdsSession(env);
  return j({ ok: true, token });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
