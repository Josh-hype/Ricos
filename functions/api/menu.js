/* GET /api/menu — canonical item list (id, name, priceP, mealAddP). The
   visual menu (photos, descriptions, categories with artwork) lives in
   order.html for now. This endpoint exists so the frontend can validate
   prices and so a future order page can render entirely from JSON. */
import { getMenu } from '../_lib/menu.js';

export const onRequestGet = async () => {
  return Response.json(getMenu(), {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
};
