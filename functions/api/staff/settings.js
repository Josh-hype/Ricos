/* /api/staff/settings — shop-level till settings.
   GET  → { routing, print, kds, printCounter }.
   POST → { routing: 'print'|'kds'|'both' } sets order routing;
          { printCounter: true|false }      toggles whether COUNTER/till sales
                                             auto-print (online always follows
                                             `print`). Either or both may be sent.
   Reached only from the PIN-gated Back Office, so requireStaff is enough. */

import { requireStaff } from '../../_lib/auth.js';
import { putSetting } from '../../_lib/kv.js';
import { getOrderRouting, routingFlags, getPrintCounter } from '../../_lib/routing.js';

const flags = async (env) => ({
  ...routingFlags(await getOrderRouting(env)),
  printCounter: await getPrintCounter(env),
});

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  return Response.json(await flags(env), { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  if (body.routing !== undefined) {
    const mode = body.routing;
    if (mode !== 'print' && mode !== 'kds' && mode !== 'both') {
      return j({ error: 'Invalid routing mode.' }, 400);
    }
    await putSetting(env, 'order-routing', mode);
  }
  if (typeof body.printCounter === 'boolean') {
    await putSetting(env, 'print-counter', body.printCounter ? 'on' : 'off');
  }
  return Response.json(await flags(env));
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
