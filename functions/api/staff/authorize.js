/* POST /api/staff/authorize — manager override. A permitted colleague enters
   their PIN to authorise one restricted action that the signed-in operator
   can't do themselves (e.g. a refund). Returns a short-lived, signed token the
   client replays on the gated request via the 'X-Authorize-Token' header.

   Body: { pin, perm }. Requires an existing staff session (so an attacker can't
   grind manager PINs cold). Rate-limited per IP, shared bucket with logins. */

import { requireStaff, makeAuthToken, checkPin, checkManagerPin } from '../../_lib/auth.js';
import { findOperatorByPin, operatorsEnabled } from '../../_lib/operators.js';
import { roleHasPermission } from '../../_lib/permissions.js';
import { logAudit } from '../../_lib/audit.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const pin = String(body.pin || '');
  const perm = String(body.perm || '');
  // The order this approval is for (when order-scoped, e.g. refund/void). The
  // token is bound to it so it can't be replayed against a different order.
  const orderId = String(body.orderId || '').toUpperCase() || null;
  if (!/^\d{4,8}$/.test(pin)) return j({ error: 'PIN must be 4–8 digits.' }, 400);
  if (!perm) return j({ error: 'Missing permission.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.STAFF_LOGIN_KV) {
    const key = `authz-attempts:${ip}`;
    const n = Number(await env.STAFF_LOGIN_KV.get(key)) || 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again shortly.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  // Legacy (shared-PIN) shops have no operator store, so findOperatorByPin can
  // never match and every override would be an impossible dead-end. Accept the
  // shop's MANAGER pin there, falling back to the staff pin when no manager pin
  // is configured — otherwise a shop without MANAGER_PIN_HASH could not cancel or
  // refund at all once those actions are gated.
  if (!(await operatorsEnabled(env))) {
    const isManager = await checkManagerPin(pin, env);
    const ok = isManager || (await checkPin(pin, env));
    if (!ok) return j({ error: 'PIN not recognised.' }, 401);
    const name = isManager ? 'Manager' : 'Staff';
    const token = await makeAuthToken(env, { op: null, name, perm, orderId });
    await logAudit(env, { op: null, opName: name, action: 'authorize', target: orderId, details: { perm, orderId, legacy: true } });
    return j({ ok: true, token, approver: { name, role: isManager ? 'manager' : 'staff' } }, 200);
  }

  const op = await findOperatorByPin(env, pin);
  if (!op) return j({ error: 'PIN not recognised.' }, 401);
  if (!roleHasPermission(op.role, perm)) {
    return j({ error: `${op.name} isn't allowed to authorise this.` }, 403);
  }

  const token = await makeAuthToken(env, { op: op.id, name: op.name, perm, orderId });
  await logAudit(env, { op: op.id, opName: op.name, action: 'authorize', target: orderId, details: { perm, orderId } });
  return j({ ok: true, token, approver: { name: op.name, role: op.role } }, 200);
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
