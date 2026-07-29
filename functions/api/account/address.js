/* POST /api/account/address — save (or refresh) a delivery address on the
   signed-in customer's profile. Used when the customer ticks "save this
   address" or implicitly when an order is placed (see /api/order). */

import { readCustomerSession } from '../../_lib/customer-auth.js';
import { getCustomer, putCustomer, upsertAddress, removeAddress, publicProfile } from '../../_lib/customer.js';

export const onRequestPost = async ({ request, env }) => {
  const session = await readCustomerSession(request.headers.get('Cookie'), env);
  if (!session) return errJson('Not signed in.', 401);

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid request.', 400); }

  if (!input.line1 || !input.postcode) {
    return errJson('Address must include at least line 1 and postcode.', 400);
  }

  const customer = await getCustomer(session.contact, env);
  if (!customer) return errJson('Account not found.', 404);

  upsertAddress(customer, input);
  await putCustomer(customer, env);

  return Response.json({ user: publicProfile(customer) });
};

/* DELETE /api/account/address — drop one saved address from the profile.
   Body: { line1, postcode } — the pair that identifies it (they carry no id).
   Returns the refreshed profile so the checkout can re-render from the truth
   rather than guessing what the server did. */
export const onRequestDelete = async ({ request, env }) => {
  const session = await readCustomerSession(request.headers.get('Cookie'), env);
  if (!session) return errJson('Not signed in.', 401);

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid request.', 400); }

  if (!input.line1 || !input.postcode) {
    return errJson('Tell us which address to remove.', 400);
  }

  const customer = await getCustomer(session.contact, env);
  if (!customer) return errJson('Account not found.', 404);

  removeAddress(customer, input);
  await putCustomer(customer, env);

  return Response.json({ user: publicProfile(customer) });
};

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
