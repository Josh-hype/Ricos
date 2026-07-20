/* POST /api/account/signin
   Body: { contact, password }
   Verifies credentials and starts a session. */

import { normaliseContact, verifyPassword, makeCustomerSession, customerCookieHeader } from '../../_lib/customer-auth.js';
import { getCustomer, publicProfile } from '../../_lib/customer.js';
import { rateLimit } from '../../_lib/rate-limit.js';

// A throwaway PBKDF2 record so a missing account still costs one hash — keeps
// the "no such account" path the same latency as a wrong-password one, so
// response timing doesn't reveal which contacts are registered.
const DUMMY_PW_RECORD = {
  salt: '00000000000000000000000000000000',
  iterations: 100000,
  hash: '0000000000000000000000000000000000000000000000000000000000000000',
};

export const onRequestPost = async ({ request, env }) => {
  if (!env.CUSTOMERS_KV) return errJson('Accounts are not configured yet.', 503);
  if (!env.SESSION_SECRET) return errJson('Session secret missing.', 503);

  const limited = await rateLimit(env, 'signin', request, 10);
  if (limited) return limited;

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid request.', 400); }

  const contact = normaliseContact(input.contact);
  const password = String(input.password || '');
  if (!contact || !password) return errJson('Please enter your contact and password.', 400);

  const customer = await getCustomer(contact.value, env);
  // Same error AND same timing for "not found" and "wrong password" so neither
  // the message nor the latency leaks which contacts are registered.
  let credsOk = false;
  if (customer) {
    credsOk = await verifyPassword(password, { salt: customer.salt, iterations: customer.iterations, hash: customer.hash });
  } else {
    await verifyPassword(password, DUMMY_PW_RECORD); // equalise timing; result discarded
  }
  if (!credsOk) return errJson('Incorrect email/phone or password.', 401);

  const token = await makeCustomerSession(customer, env);
  // The customer app sends "X-Client: app" and stores the returned token to
  // send as a Bearer header (its WebView can't use the cross-origin cookie).
  // The web omits the header, so the token never appears in a browser body —
  // the HttpOnly cookie stays the only credential there. Mirrors staff login.
  const wantsToken = request.headers.get('X-Client') === 'app';
  return new Response(JSON.stringify({ user: publicProfile(customer), ...(wantsToken ? { token } : {}) }), {
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
