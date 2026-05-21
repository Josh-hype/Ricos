/* POST /api/account/signup
   Body: { name, contact, password }
   Creates a customer record (rejects duplicates) and starts a session. */

import { normaliseContact, hashPassword, makeCustomerSession, customerCookieHeader } from '../../_lib/customer-auth.js';
import { getCustomer, putCustomer, newCustomerId, publicProfile } from '../../_lib/customer.js';

export const onRequestPost = async ({ request, env }) => {
  if (!env.CUSTOMERS_KV) return errJson('Accounts are not configured yet.', 503);
  if (!env.SESSION_SECRET) return errJson('Session secret missing.', 503);

  let input;
  try { input = await request.json(); }
  catch { return errJson('Invalid request.', 400); }

  const name = (input.name || '').trim();
  const password = String(input.password || '');
  const contact = normaliseContact(input.contact);

  if (name.length < 2) return errJson('Please enter your name.', 400);
  if (!contact) return errJson('Please enter a valid email or UK mobile number.', 400);
  if (password.length < 6) return errJson('Password must be at least 6 characters.', 400);

  const existing = await getCustomer(contact.value, env);
  if (existing) return errJson('An account with that contact already exists. Try signing in.', 409);

  const pw = await hashPassword(password);
  const now = new Date().toISOString();
  const customer = {
    id: newCustomerId(),
    name,
    contact: contact.value,
    contactType: contact.type,
    salt: pw.salt,
    iterations: pw.iterations,
    hash: pw.hash,
    createdAt: now,
    addresses: [],
  };
  await putCustomer(customer, env);

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
