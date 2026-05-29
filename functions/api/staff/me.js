/* GET /api/staff/me — who is signed in + what they're allowed to do, so the
   till can render the operator's identity and gate the UI. In legacy mode (no
   operators configured) there's no named operator and full permissions are
   returned, preserving the original behaviour. */

import { resolveSession } from '../../_lib/auth.js';
import { operatorsEnabled } from '../../_lib/operators.js';
import { permissionsForRole, ALL_PERMISSIONS } from '../../_lib/permissions.js';

export const onRequestGet = async ({ request, env }) => {
  const s = await resolveSession(request, env);
  if (!s) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!(await operatorsEnabled(env))) {
    return Response.json(
      { operatorsEnabled: false, operator: null, permissions: ALL_PERMISSIONS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Legacy session opened before operators existed: keep it fully capable so
  // whoever is setting up the team can finish; it expires within the TTL.
  if (!s.op) {
    return Response.json(
      { operatorsEnabled: true, operator: null, permissions: ALL_PERMISSIONS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const role = s.role || 'staff';
  return Response.json({
    operatorsEnabled: true,
    operator: s.op ? { id: s.op, name: s.name, role, colour: s.colour || null } : null,
    permissions: permissionsForRole(role),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
