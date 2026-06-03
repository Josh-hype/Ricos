/* POST /api/staff/terminal/register — register a physical Terminal reader (e.g. BBPOS
   WisePOS E) using the 3-word code shown on its screen ("register this reader…"). It
   ensures a Terminal Location exists on the shop's connected account (creating one from
   the shop address if needed), then registers the reader to it. Once registered + online
   the reader is auto-discovered by /terminal/charge — nothing else to configure. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { listTerminalLocations, createTerminalLocation, registerTerminalReader } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const code = String(body.code || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z]+-[a-z]+-[a-z]+$/.test(code)) {
    return err('Enter the three words shown on the reader, e.g. cherry-fine-chairman.', 400);
  }

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  // Readers belong to a Terminal Location. Reuse one if present, else create it from the
  // shop's address. Stripe wants an ISO country code; config stores a friendly name.
  let location;
  try {
    const locs = await listTerminalLocations(acct, env);
    location = (locs.data || [])[0];
    if (!location) {
      const biz = config.business || {};
      const addr = biz.address || {};
      location = await createTerminalLocation(
        biz.tradingName || biz.shortName || 'Counter',
        {
          line1: addr.line1 || 'Counter',
          city: addr.city || '',
          postal_code: addr.postcode || '',
          country: 'GB',
        },
        acct, env,
      );
    }
  } catch (e) {
    return err('Could not set up a Terminal location: ' + (e.message || 'Stripe error'), 502);
  }

  let reader;
  try {
    reader = await registerTerminalReader(
      { registrationCode: code, label: (body.label || 'Counter reader'), location: location.id },
      acct, env,
    );
  } catch (e) {
    return err(e.message || 'Could not register the reader — check the code and try again.', 400);
  }

  return Response.json({
    ok: true,
    reader: { id: reader.id, label: reader.label, status: reader.status, device_type: reader.device_type },
    location: { id: location.id, display_name: location.display_name },
  });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
