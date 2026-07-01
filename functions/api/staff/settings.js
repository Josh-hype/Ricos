/* /api/staff/settings — shop-level till settings.
   GET  → { routing, print, kds }  (effective order routing + derived flags).
   POST → { routing: 'print'|'kds'|'both' } sets it. Reached only from the
   PIN-gated Back Office, so requireStaff is enough. */

import { requireStaff } from '../../_lib/auth.js';
import { putSetting } from '../../_lib/kv.js';
import { getConfig } from '../../_lib/config.js';
import { getOrderRouting, routingFlags, printCounterOnAccept } from '../../_lib/routing.js';

// Merge the config-derived flag (printCounter) into the routing flags the till reads.
const withFlags = (mode) => ({ ...routingFlags(mode), printCounter: printCounterOnAccept(getConfig()) });

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  return Response.json(withFlags(await getOrderRouting(env)), { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  const mode = body.routing;
  if (mode !== 'print' && mode !== 'kds' && mode !== 'both') {
    return j({ error: 'Invalid routing mode.' }, 400);
  }
  await putSetting(env, 'order-routing', mode);
  return Response.json(withFlags(mode));
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
