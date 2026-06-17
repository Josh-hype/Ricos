/* GET /api/config — public config + Stripe publishable key + connected
   account id (needed by Stripe.js for direct charges) + slot list. */
import { getPublicConfig, getConfig } from '../_lib/config.js';
import { staffPasswordEnabled } from '../_lib/auth.js';
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
    // Address finder lights up only where an Ideal Postcodes key is configured;
    // otherwise the order page + till fall back to manual address entry.
    addressLookup: { enabled: !!(env.IDEALPOSTCODES_API_KEY || env.ADDRESS_LOOKUP_API_KEY) },
    // Staff login mode: when a username + password is configured the staff page
    // shows those fields instead of the numeric PIN pad (the mode, never the creds).
    staffLogin: { passwordMode: staffPasswordEnabled(env) },
    isOpenNow: isOpenNow(fullCfg),
    slots: listSlots(fullCfg),
  }, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};
