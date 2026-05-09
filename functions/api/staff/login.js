/* POST /api/staff/login — exchange a PIN for a session cookie.
   Rate-limited via env.STAFF_LOGIN_KV (best-effort; if missing, skipped). */

import { checkPin, makeSession, sessionCookieHeader } from '../../_lib/auth.js';

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'PIN must be 4–8 digits.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.STAFF_LOGIN_KV) {
    const key = `attempts:${ip}`;
    const raw = await env.STAFF_LOGIN_KV.get(key);
    const n = raw ? Number(raw) : 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  const ok = await checkPin(pin, env);
  if (!ok) return j({ error: 'Wrong PIN.' }, 401);

  const token = await makeSession(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(token),
    },
  });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
