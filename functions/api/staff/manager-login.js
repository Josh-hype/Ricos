/* POST /api/staff/manager-login — second-factor PIN that unlocks the
   financial views (Today's summary, Z report).

   Requires an existing staff session (so a randomly knocking attacker
   can't grind manager PINs without first cracking the staff PIN). Rate-
   limited per-IP via STAFF_LOGIN_KV — same bucket as staff logins so a
   compromised IP can't burn either lock independently.

   Returns the manager session cookie ('rsm'). If MANAGER_PIN_HASH isn't
   configured, the endpoint is closed off (the gate isn't enabled, so
   there's nothing to log in to). */

import {
  requireStaff, checkManagerPin, makeManagerSession,
  managerSessionCookieHeader, managerEnabled,
} from '../../_lib/auth.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  if (!managerEnabled(env)) {
    return j({ error: 'Manager protection isn\'t configured for this shop.' }, 400);
  }

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'PIN must be 4–8 digits.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.STAFF_LOGIN_KV) {
    const key = `mgr-attempts:${ip}`;
    const raw = await env.STAFF_LOGIN_KV.get(key);
    const n = raw ? Number(raw) : 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  const ok = await checkManagerPin(pin, env);
  if (!ok) return j({ error: 'Wrong manager PIN.' }, 401);

  const token = await makeManagerSession(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': managerSessionCookieHeader(token),
    },
  });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
