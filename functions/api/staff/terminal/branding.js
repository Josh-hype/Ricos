/* POST /api/staff/terminal/branding — show the shop's logo on the card reader's idle
   screen (instead of Stripe's). Fetches this shop's /logo.png, uploads it to Stripe as a
   terminal splash image on the connected account, and points a Terminal Configuration's
   splash screen at it, set as the account default so the shop's readers adopt it. The
   reader applies it on its next reboot / idle refresh. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { uploadTerminalSplash, createTerminalConfiguration } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  // The function runs on the shop's own domain, so its /logo.png is this shop's logo.
  let blob, ctype;
  try {
    const origin = new URL(request.url).origin;
    const r = await fetch(origin + '/logo.png', { cf: { cacheTtl: 0 } });
    if (!r.ok) throw new Error('logo ' + r.status);
    ctype = r.headers.get('content-type') || 'image/png';
    blob = new Blob([await r.arrayBuffer()], { type: ctype });
  } catch (e) {
    return err('Could not load the shop logo (/logo.png).', 502);
  }

  let file;
  try {
    file = await uploadTerminalSplash(blob, 'reader-splash.png', acct, env);
  } catch (e) {
    return err('Stripe rejected the logo image: ' + (e.message || 'upload failed'), 400);
  }

  let configuration;
  try {
    configuration = await createTerminalConfiguration({ splashscreenFileId: file.id, isAccountDefault: true }, acct, env);
  } catch (e) {
    return err('Could not apply the reader branding: ' + (e.message || 'Stripe error'), 502);
  }

  return Response.json({ ok: true, fileId: file.id, configurationId: configuration.id });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
