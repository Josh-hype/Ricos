/* /api/staff/settings — shop-level till settings.
   GET  → the effective settings the till needs (currently { kdsRouting }).
   POST → change a setting (manager-gated where a manager PIN is configured).

   kdsRouting = "send accepted orders to the KDS instead of printing". Effective
   value = the KV override if set, else the shop config default (config.kds.enabled). */

import { requireStaff } from '../../_lib/auth.js';
import { getConfig } from '../../_lib/config.js';
import { getSetting, putSetting } from '../../_lib/kv.js';

async function effectiveKdsRouting(env) {
  const v = await getSetting(env, 'kds-routing');
  if (v === 'on') return true;
  if (v === 'off') return false;
  const cfg = getConfig().kds || {};
  return !!cfg.enabled; // per-shop default (defaults to print when unset)
}

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  return Response.json({ kdsRouting: await effectiveKdsRouting(env) }, { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }) => {
  // Reached only from the PIN-gated Back Office in the UI; requireStaff is enough.
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  if (typeof body.kdsRouting === 'boolean') {
    await putSetting(env, 'kds-routing', body.kdsRouting ? 'on' : 'off');
  }
  return Response.json({ kdsRouting: await effectiveKdsRouting(env) });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
