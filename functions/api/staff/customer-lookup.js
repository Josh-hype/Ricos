/* GET /api/staff/customer-lookup?phone=… — who is this, and where do they live?
   (PIN-gated.)

   For phone orders. Staff type the caller's number, the till offers the name and
   the addresses that number has ordered to before, and a regular stops dictating
   their address every Friday. It is also the half that makes caller ID worth
   having: a number popping up on screen tells you nothing on its own.

   Reads the SAME records as the customer accounts on the website (CUSTOMERS_KV,
   keyed by normalised contact), so someone who orders online and by phone is one
   person with one address book. Never returns the auth fields — publicProfile()
   drops salt/hash/iterations — and the shape is deliberately the smallest thing
   the till needs rather than the whole record.

   Gated on pos.customerLookup so it stays dark for shops that haven't asked for
   it; without the flag this 404s exactly as if the route did not exist. */

import { requireStaff } from '../../_lib/auth.js';
import { getConfig } from '../../_lib/config.js';
import { getCustomer, normalisePhoneKey } from '../../_lib/customer.js';

export const onRequestGet = async ({ request, env }) => {
  const config = getConfig();
  if (!config.pos?.customerLookup) return new Response('Not found', { status: 404 });

  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const raw = new URL(request.url).searchParams.get('phone') || '';
  const phone = normalisePhoneKey(raw);
  // Not an error: staff are typing, and every keystroke before the number is
  // complete lands here. A quiet "nobody" keeps the till's lookup silent until
  // there is actually something to say.
  if (!phone) return j({ ok: true, found: false });

  const customer = await getCustomer(phone, env);
  if (!customer) return j({ ok: true, found: false });

  // Most recently used first, so the till can offer addresses[0] as the default.
  const addresses = [...(customer.addresses || [])]
    .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
    .map(a => ({
      line1: a.line1 || '',
      line2: a.line2 || '',
      postcode: a.postcode || '',
      notes: a.notes || '',
    }));

  return j({ ok: true, found: true, name: customer.name || '', phone, addresses });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
