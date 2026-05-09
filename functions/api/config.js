/* GET /api/config — public config + Stripe publishable key + slot list. */
import { getPublicConfig } from '../_lib/config.js';
import { listSlots, isOpenNow } from '../_lib/hours.js';

export const onRequestGet = async ({ env }) => {
  const cfg = getPublicConfig();
  const fullCfg = await import('../_lib/config.js').then(m => m.getConfig());
  return Response.json({
    ...cfg,
    stripe: {
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
    },
    isOpenNow: isOpenNow(fullCfg),
    slots: listSlots(fullCfg),
  }, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};
