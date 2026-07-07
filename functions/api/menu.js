/* GET /api/menu — canonical item list (id, name, priceP, mealAddP). The
   visual menu (photos, descriptions, categories with artwork) lives in
   order.html for now. This endpoint exists so the frontend can validate
   prices and so a future order page can render entirely from JSON. */
import { resolveMenu } from '../_lib/menu-store.js';

export const onRequestGet = async ({ env }) => {
  // Owner-edited menu from KV if present, else the static build-time menu.
  return Response.json(await resolveMenu(env), {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};
