/* GET /api/availability — public list of currently sold-out item ids, so the
   order page can grey them out. Tiny payload, no-store so it reflects a staff
   toggle within seconds. The /api/order endpoint enforces it authoritatively. */
import { getOffMap } from '../_lib/availability.js';

export const onRequestGet = async ({ env }) => {
  const map = await getOffMap(env);
  return Response.json({ off: Object.keys(map) }, { headers: { 'Cache-Control': 'no-store' } });
};
