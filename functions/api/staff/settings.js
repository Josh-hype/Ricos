/* /api/staff/settings — shop-level till settings.
   GET  → { routing, print, kds, printCounter }.
   POST → { routing: 'print'|'kds'|'both' } sets order routing;
          { printCounter: true|false }      toggles whether COUNTER/till sales
                                             auto-print (online always follows
                                             `print`). Either or both may be sent.
   Reached only from the PIN-gated Back Office, so requireStaff is enough. */

import { requireStaff, resolveSession, checkPin, checkManagerPin } from '../../_lib/auth.js';
import { putSetting } from '../../_lib/kv.js';
import { logAudit } from '../../_lib/audit.js';
import { getOrderRouting, routingFlags, getPrintCounter } from '../../_lib/routing.js';
import { getOrderingPause, setOrderingPause } from '../../_lib/ordering-pause.js';

const flags = async (env) => ({
  ...routingFlags(await getOrderRouting(env)),
  printCounter: await getPrintCounter(env),
  orderingPaused: (await getOrderingPause(env)).paused,
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
  // Pause / resume ONLINE ordering for the rest of today (counter sales unaffected).
  if (typeof body.pauseOrdering === 'boolean') {
    // Pausing takes the shop offline, so gate it behind a PIN to prevent an
    // accidental double-tap doing it silently. Resuming stays one-tap (safe).
    if (body.pauseOrdering === true) {
      const pin = String(body.confirmPin || '');
      const ok = (await checkPin(pin, env)) || (await checkManagerPin(pin, env));
      if (!ok) return j({ error: 'Enter your PIN to pause online orders.' }, 403);
    }
    const sess = await resolveSession(request, env);
    await setOrderingPause(env, body.pauseOrdering, sess?.name || null);
    await logAudit(env, {
      op: sess?.op || null, opName: sess?.name || null,
      action: body.pauseOrdering ? 'ordering_paused' : 'ordering_resumed', target: 'online',
    });
  }
  return Response.json(await flags(env));
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
