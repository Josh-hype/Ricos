/* GET /api/config — public config + Stripe publishable key + connected
   account id (needed by Stripe.js for direct charges) + slot list. */
import { getPublicConfig, getConfig } from '../_lib/config.js';
import { staffPasswordEnabled } from '../_lib/auth.js';
import { listSlots, isOpenNow } from '../_lib/hours.js';
import { getOrderingPause } from '../_lib/ordering-pause.js';

export const onRequestGet = async ({ env }) => {
  const cfg = getPublicConfig();
  const fullCfg = getConfig();
  // A back-office "pause online ordering" toggle surfaces to the customer via the
  // same `closure` field the order page already understands (banner + disabled
  // checkout). A real all-day config closure takes precedence over a live pause.
  const pause = await getOrderingPause(env);
  const closure = cfg.closure || (pause.paused
    ? { title: 'Online orders paused', message: "We've paused online orders for now — please check back a little later, or call us to order." }
    : null);
  return Response.json({
    ...cfg,
    closure,
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
