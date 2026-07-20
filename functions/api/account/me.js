/* GET /api/account/me — return the signed-in customer's public profile.
   Returns 200 with { user: null } when no valid session, so the frontend
   can call this unconditionally on boot without treating it as an error. */

import { resolveCustomerSession } from '../../_lib/customer-auth.js';
import { getCustomer, publicProfile } from '../../_lib/customer.js';

export const onRequestGet = async ({ request, env }) => {
  const session = await resolveCustomerSession(request, env);
  if (!session) return Response.json({ user: null });

  const customer = await getCustomer(session.contact, env);
  return Response.json({ user: publicProfile(customer) });
};
