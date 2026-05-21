/* GET /api/config — public config + Stripe publishable key + connected
   account id (needed by Stripe.js for direct charges) + slot list. */
import { getPublicConfig, getConfig } from '../_lib/config.js';
import { listSlots, isOpenNow } from '../_lib/hours.js';

export const onRequestGet = async ({ env }) => {
  const cfg = getPublicConfig();
  const fullCfg = getConfig();
  return Response.json({
    ...cfg,
    stripe: {
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
      connectedAccountId: fullCfg.stripe?.connectedAccountId || null,
    },
    // Domain-restricted token for getAddress.io autocomplete from the
    // browser. Safe to expose because it's origin-locked at getAddress.io
    // side. Falls back to null if not configured.
    getAddressDomainToken: env.GETADDRESS_DOMAIN_TOKEN || null,
    isOpenNow: isOpenNow(fullCfg),
    slots: listSlots(fullCfg),
  }, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};
