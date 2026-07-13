/* GET /api/menu-visual — the customer-facing display menu.

   Returns the owner-edited menu from KV if one exists, else falls back to the
   static /menu-visual.json asset (fetched internally). The order page fetches
   this so owner edits go live without a redeploy; with no override in KV the
   response is identical to the static file it replaces. */
import { resolveVisual } from '../_lib/menu-store.js';

export const onRequestGet = async ({ request, env }) => {
  const visual = await resolveVisual(env, request);
  return Response.json(visual, { headers: { 'Cache-Control': 'public, max-age=20' } });
};
