/* GET /api/admin/me — who's looking, and is the back-office wired up.
   Unauthenticated (it REPORTS auth state); leaks no figures. The dashboard
   page calls this on load to choose the login screen vs the dashboard. */
import { readOwnerSession, ownerEnabled } from '../../_lib/admin-auth.js';
import { getPlatform } from '../../_lib/registry.js';

export const onRequestGet = async ({ request, env }) => {
  const session = await readOwnerSession(request.headers.get('Cookie'), env);
  const platform = getPlatform();
  return Response.json({
    platform: { name: platform.name || 'Lumin Labs', owner: platform.owner || null },
    configured: ownerEnabled(env),     // OWNER_PASSWORD_HASH + SESSION_SECRET present
    authed: !!session,
    stripeReady: !!env.STRIPE_SECRET_KEY,
    usernameRequired: !!env.OWNER_USERNAME,
  }, { headers: { 'Cache-Control': 'no-store' } });
};
