/* Staff item-availability ("sold out") control, used by the back office.
   GET  -> the full menu (by category) annotated with each item's off state.
   POST -> { itemId, off:true, mode:'tomorrow'|'manual' } | { itemId, off:false }
   Staff-gated (the back office is already PIN/manager protected). */
import { requireStaff, csrfOriginCheck } from '../../_lib/auth.js';
import { getMenu } from '../../_lib/menu.js';
import { getOffMap, setOff, setOn } from '../../_lib/availability.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const map = await getOffMap(env);
  const categories = getMenu().map((c) => ({
    id: c.id,
    name: c.name,
    items: (c.items || []).map((i) => {
      const rec = map[i.id];
      return { id: i.id, name: i.name, off: !!rec, mode: rec?.mode || null, untilDay: rec?.untilDay || null };
    }),
  }));
  return Response.json({ categories }, { headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const itemId = String(body.itemId || '');
  const item = getMenu().flatMap((c) => c.items || []).find((i) => i.id === itemId);
  if (!item) return j({ error: 'Unknown item.' }, 400);

  if (body.off) {
    const mode = body.mode === 'tomorrow' ? 'tomorrow' : 'manual';
    const rec = await setOff(env, itemId, mode, item.name);
    return Response.json({ ok: true, itemId, off: true, mode: rec?.mode || mode, untilDay: rec?.untilDay || null });
  }
  await setOn(env, itemId);
  return Response.json({ ok: true, itemId, off: false });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
