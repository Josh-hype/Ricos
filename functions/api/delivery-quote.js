/* GET /api/delivery-quote?postcode=... — live delivery check + fee for the
   order page. Used by radius shops (the client can't compute distance
   locally); outcode shops validate locally and don't need it. The fee here
   is informational — /api/order recomputes it authoritatively. */

import { getConfig } from '../_lib/config.js';
import { resolveDelivery } from '../_lib/delivery.js';

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const postcode = url.searchParams.get('postcode') || '';
  const config = getConfig();
  if (!config.fulfillment?.delivery?.enabled) {
    return Response.json({ ok: false, reason: 'Delivery is not available right now.' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const dq = await resolveDelivery(postcode, config);
  return Response.json(dq, { headers: { 'Cache-Control': 'no-store' } });
};
