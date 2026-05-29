/* GET /api/staff/audit — the sensitive-action audit log for a London-day range
   (?date= or ?from=&to=, default today). Manager-gated, exactly like the
   financial views: reports.view permission in per-operator mode, manager PIN in
   legacy mode. */

import { requireStaff, requireManager } from '../../_lib/auth.js';
import { operatorsEnabled } from '../../_lib/operators.js';
import { requirePermission } from '../../_lib/permissions.js';
import { resolveDayRange } from '../../_lib/kv.js';
import { listAudit } from '../../_lib/audit.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  if (await operatorsEnabled(env)) {
    const pd = await requirePermission(request, env, 'reports.view');
    if (pd) return pd;
  } else {
    const mgrDenied = await requireManager(request, env);
    if (mgrDenied) return mgrDenied;
  }

  const { from, to } = resolveDayRange(new URL(request.url));
  const entries = await listAudit(env, from, to);
  return Response.json({ from, to, entries }, { headers: { 'Cache-Control': 'no-store' } });
};
