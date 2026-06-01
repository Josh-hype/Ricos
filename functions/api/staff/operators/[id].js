/* /api/staff/operators/:id
     POST   — update { name?, role?, pin?, colour?, active? }
     DELETE — deactivate (kept on record for the audit trail, PIN disabled)
   Manager+ (operators.manage). */

import { requirePermission } from '../../../_lib/permissions.js';
import { updateOperator, deactivateOperator } from '../../../_lib/operators.js';
import { logAudit } from '../../../_lib/audit.js';

export const onRequestPost = async ({ request, env, params }) => {
  const ctx = {};
  const denied = await requirePermission(request, env, 'operators.manage', ctx);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  try {
    const op = await updateOperator(env, String(params.id), {
      name: body.name, role: body.role, pin: body.pin, colour: body.colour, active: body.active,
    }, ctx.operator?.role);
    await logAudit(env, {
      op: ctx.operator?.id || null, opName: ctx.operator?.name || null,
      action: 'operator.update', target: op.id,
      details: { name: op.name, role: op.role, active: op.active, pinChanged: !!(body.pin && body.pin !== '') },
    });
    return Response.json({ operator: op });
  } catch (e) {
    return j({ error: e?.message || 'Could not update operator.' }, 400);
  }
};

export const onRequestDelete = async ({ request, env, params }) => {
  const ctx = {};
  const denied = await requirePermission(request, env, 'operators.manage', ctx);
  if (denied) return denied;

  try {
    const op = await deactivateOperator(env, String(params.id), ctx.operator?.role);
    await logAudit(env, {
      op: ctx.operator?.id || null, opName: ctx.operator?.name || null,
      action: 'operator.deactivate', target: op.id, details: { name: op.name },
    });
    return Response.json({ operator: op });
  } catch (e) {
    return j({ error: e?.message || 'Could not remove operator.' }, 400);
  }
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
