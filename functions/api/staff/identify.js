/* POST /api/staff/identify — "whose code is this?" for per-order staff
   attribution. The till stays signed in (often as one operator), but each counter
   order records the staff who entered their code at the mode picker. Returns the
   operator { id, name, role } for a PIN, or 401 if it isn't recognised.

   Requires an existing staff session (so codes can't be ground cold from outside).
   Unlike /authorize (rate-limited to 8/10min for rare manager overrides), this
   fires on every order start — so only *failed* codes are rate-limited per IP;
   a correct code never counts against the bucket. No token, no audit entry — it
   only resolves an identity; the actual 'sell' permission is still gated on the
   counter-order request. */

import { requireStaff } from '../../_lib/auth.js';
import { findOperatorByPin } from '../../_lib/operators.js';

const MAX_FAILS = 12; // wrong codes per IP per 10 min before a cooldown

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'Code must be 4–8 digits.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const failKey = `identify-fails:${ip}`;
  if (env.STAFF_LOGIN_KV) {
    const n = Number(await env.STAFF_LOGIN_KV.get(failKey)) || 0;
    if (n >= MAX_FAILS) return j({ error: 'Too many wrong codes. Try again shortly.' }, 429);
  }

  const op = await findOperatorByPin(env, pin);
  if (!op) {
    if (env.STAFF_LOGIN_KV) {
      const n = Number(await env.STAFF_LOGIN_KV.get(failKey)) || 0;
      await env.STAFF_LOGIN_KV.put(failKey, String(n + 1), { expirationTtl: 600 });
    }
    return j({ error: 'Code not recognised.' }, 401);
  }

  return j({ ok: true, operator: { id: op.id, name: op.name, role: op.role } }, 200);
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
