/* POST /api/staff/login — exchange a PIN for a session cookie.
   Rate-limited via env.STAFF_LOGIN_KV (best-effort; if missing, skipped). */

import { checkPin, makeSession, sessionCookieHeader, staffPasswordEnabled, checkStaffPassword } from '../../_lib/auth.js';
import { operatorsEnabled, findOperatorByPin } from '../../_lib/operators.js';
import { logAudit } from '../../_lib/audit.js';

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  // The native app (the TILL) sends "X-Client: app" and stores the returned token
  // to send as a Bearer header (it can't use the cross-origin cookie). The web
  // omits the header, so the token is never put in the body there — the HttpOnly
  // cookie stays the only credential on the web.
  const isApp = request.headers.get('X-Client') === 'app';
  const wantsToken = isApp;

  // Rate-limit FIRST so it covers the PIN and the username/password alike, per IP.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const attemptsKey = `attempts:${ip}`;
  if (env.STAFF_LOGIN_KV) {
    const raw = await env.STAFF_LOGIN_KV.get(attemptsKey);
    const n = raw ? Number(raw) : 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(attemptsKey, String(n + 1), { expirationTtl: 600 });
  }
  // Clear the failed-attempt counter on a correct login so a busy till that
  // fat-fingers a few times can't lock out the next legitimate operator.
  const clearAttempts = () => env.STAFF_LOGIN_KV?.delete(attemptsKey);

  // Username + password mode — the WEB back office only (special URL in a browser).
  // The TILL app always uses operator codes (fast per-staff login), so password mode
  // never applies to it: web gets the strong username/password, the till keeps its
  // codes with the manager-PIN gate on cancellations. Set per shop via
  // STAFF_USERNAME + STAFF_PASSWORD_HASH; dormant until those env vars exist.
  if (staffPasswordEnabled(env) && !isApp) {
    if (!(await checkStaffPassword(body.username, body.password, env))) {
      return j({ error: 'Wrong username or password.' }, 401);
    }
    await clearAttempts();
    const token = await makeSession(env);
    // Web back-office (owner) login by username/password. Intentionally a
    // full-access, op-less session (no per-order PIN friction for the owner);
    // we tag the audit entry so it's distinguishable from a PIN login.
    await logAudit(env, { action: 'login', opName: env.STAFF_USERNAME || 'web', details: { via: 'password' } });
    return new Response(JSON.stringify({ ok: true, ...(wantsToken ? { token } : {}) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookieHeader(token) },
    });
  }

  // PIN modes (existing) — numeric only.
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'PIN must be 4–8 digits.' }, 400);

  // Per-operator mode: the PIN identifies a named operator (Toast/Square style).
  if (await operatorsEnabled(env)) {
    const op = await findOperatorByPin(env, pin);
    if (!op) return j({ error: 'PIN not recognised.' }, 401);
    await clearAttempts();
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
  await clearAttempts();

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
