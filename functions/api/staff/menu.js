/* Owner menu editor API (Back Office → Menu).
   GET    -> the unified, editable menu (KV override if set, else built from the
             static pair for first-time editing) + which source is live.
   PUT    -> validate a unified menu and save it live to KV.
   DELETE -> discard edits and revert to the built-in (static) menu.

   Staff-gated + CSRF-checked, like the sold-out control. The Back Office entry
   is already manager-PIN protected on the client. Prices are validated and both
   menu shapes are DERIVED from this one document, so a shown/charged mismatch
   cannot be saved. */
import { requireStaff, csrfOriginCheck } from '../../_lib/auth.js';
import { getMenu } from '../../_lib/menu.js';
import { getUnified, unifyStatic, validateUnified, saveUnified, clearUnified } from '../../_lib/menu-store.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const live = await getUnified(env);
  let doc = live;
  if (!doc) {
    let visual = [];
    try {
      const r = await fetch(new URL('/menu-visual.json', request.url).toString());
      if (r.ok) visual = await r.json();
    } catch { /* fall back to pricing-only */ }
    doc = unifyStatic(getMenu(), visual);
  }
  return Response.json({ menu: doc, source: live ? 'live' : 'built-in' }, { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPut = async ({ request, env }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const v = validateUnified(body.menu || body);
  if (!v.ok) return j({ error: 'A few things need fixing before this can go live.', problems: v.errors }, 400);

  v.doc.updatedAt = new Date().toISOString();
  await saveUnified(env, v.doc);
  return Response.json({ ok: true, categories: v.doc.categories.length, items: v.doc.categories.reduce((n, c) => n + c.items.length, 0) });
};

export const onRequestDelete = async ({ request, env }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  await clearUnified(env);
  return Response.json({ ok: true });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
