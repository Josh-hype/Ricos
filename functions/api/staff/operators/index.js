/* /api/staff/operators
     GET  — list operators (manager+, or any staff while none exist yet so the
            first one can be bootstrapped)
     POST — create an operator { name, role, pin, colour? } (same gate)

   Adding the first operator switches the shop from legacy single-PIN mode into
   per-operator mode. */

import { requireStaff } from '../../../_lib/auth.js';
import { requirePermission } from '../../../_lib/permissions.js';
import { operatorsEnabled, listOperators, createOperator } from '../../../_lib/operators.js';
import { logAudit } from '../../../_lib/audit.js';

// While no operators exist, any authenticated staff session may manage them
// (bootstrap). Once one exists, require the operators.manage permission.
async function gate(request, env, out) {
  if (await operatorsEnabled(env)) return requirePermission(request, env, 'operators.manage', out);
  return requireStaff(request, env);
}

export const onRequestGet = async ({ request, env }) => {
  const denied = await gate(request, env, {});
  if (denied) return denied;
  return Response.json({ operators: await listOperators(env) }, { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }) => {
  const ctx = {};
  const denied = await gate(request, env, ctx);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  try {
    const op = await createOperator(env, {
      name: body.name, role: body.role, pin: body.pin, colour: body.colour,
    });
    await logAudit(env, {
      op: ctx.operator?.id || null, opName: ctx.operator?.name || 'bootstrap',
      action: 'operator.create', target: op.id, details: { name: op.name, role: op.role },
    });
    return Response.json({ operator: op });
  } catch (e) {
    return j({ error: e?.message || 'Could not create operator.' }, 400);
  }
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
