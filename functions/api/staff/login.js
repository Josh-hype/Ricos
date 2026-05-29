/* POST /api/staff/login — exchange a PIN for a session cookie.
   Rate-limited via env.STAFF_LOGIN_KV (best-effort; if missing, skipped). */

import { checkPin, makeSession, sessionCookieHeader } from '../../_lib/auth.js';
import { operatorsEnabled, findOperatorByPin } from '../../_lib/operators.js';
import { logAudit } from '../../_lib/audit.js';

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'PIN must be 4–8 digits.' }, 400);
  // The native app sends "X-Client: app" and stores the returned token to send
  // as a Bearer header (it can't use the cross-origin cookie). The web omits the
  // header, so the token is never put in the body there — the HttpOnly cookie
  // stays the only credential on the web.
  const wantsToken = request.headers.get('X-Client') === 'app';

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.STAFF_LOGIN_KV) {
    const key = `attempts:${ip}`;
    const raw = await env.STAFF_LOGIN_KV.get(key);
    const n = raw ? Number(raw) : 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  // Per-operator mode: the PIN identifies a named operator (Toast/Square style).
  if (await operatorsEnabled(env)) {
    const op = await findOperatorByPin(env, pin);
    if (!op) return j({ error: 'PIN not recognised.' }, 401);
    const token = await makeSession(env, op);
    await logAudit(env, { op: op.id, opName: op.name, action: 'login' });
    return new Response(JSON.stringify({
      ok: true,
      operator: { id: op.id, name: op.name, role: op.role, colour: op.colour },
      ...(wantsToken ? { token } : {}),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookieHeader(token) },
    });
  }

  // Legacy mode: single shared staff PIN.
  const ok = await checkPin(pin, env);
  if (!ok) return j({ error: 'Wrong PIN.' }, 401);

  const token = await makeSession(env);
  return new Response(JSON.stringify({ ok: true, ...(wantsToken ? { token } : {}) }), {
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
