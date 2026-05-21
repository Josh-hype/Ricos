/* POST /api/account/signin
   Body: { contact, password }
   Verifies credentials and starts a session. */

import { normaliseContact, verifyPassword, makeCustomerSession, customerCookieHeader } from '../../_lib/customer-auth.js';
import { getCustomer, publicProfile } from '../../_lib/customer.js';

export const onRequestPost = async ({ request, env }) => {
  if (!env.CUSTOMERS_KV) return errJson('Accounts are not configured yet.', 503);
  if (!env.SESSION_SECRET) return errJson('Session secret missing.', 503);

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid request.', 400); }

  const contact = normaliseContact(input.contact);
  const password = String(input.password || '');
  if (!contact || !password) return errJson('Please enter your contact and password.', 400);

  const customer = await getCustomer(contact.value, env);
  // Same error for "not found" and "wrong password" so we don't leak which
  // contacts are registered.
  if (!customer || !(await verifyPassword(password, { salt: customer.salt, iterations: customer.iterations, hash: customer.hash }))) {
    return errJson('Incorrect email/phone or password.', 401);
  }

  const token = await makeCustomerSession(customer.contact, env);
  return new Response(JSON.stringify({ user: publicProfile(customer) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': customerCookieHeader(token),
    },
  });
};

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
