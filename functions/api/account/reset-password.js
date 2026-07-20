/* POST /api/account/reset-password
   Body: { token, password }
   Verifies a reset token (HMAC + 1-hour expiry + fingerprinted on the old
   hash so it self-invalidates once used) and replaces the password. */

import { verifyResetToken, hashPassword, makeCustomerSession, customerCookieHeader } from '../../_lib/customer-auth.js';
import { getCustomer, putCustomer, publicProfile } from '../../_lib/customer.js';

export const onRequestPost = async ({ request, env }) => {
  if (!env.CUSTOMERS_KV || !env.SESSION_SECRET) return errJson('Accounts are not configured yet.', 503);

  let input;
  try { input = await request.json(); } catch { return errJson('Invalid request.', 400); }

  const password = String(input.password || '');
  if (password.length < 6) return errJson('Password must be at least 6 characters.', 400);
  if (password.length > 256) return errJson('Password is too long (max 256 characters).', 400);

  const decoded = await verifyResetToken(input.token, env);
  if (!decoded) return errJson('This reset link is invalid or has expired. Please request a new one.', 400);

  const customer = await getCustomer(decoded.contact, env);
  // Same response as a bad token — don't reveal that the token was valid but
  // the account has since been removed.
  if (!customer) return errJson('This reset link is invalid or has expired. Please request a new one.', 400);

  // Fingerprint match: the token was issued for this exact password hash.
  // If the password has already been changed since, the token is dead.
  if (customer.hash.slice(0, 16) !== decoded.fp) {
    return errJson('This reset link has already been used. Please request a new one.', 400);
  }

  const pw = await hashPassword(password);
  customer.salt = pw.salt;
  customer.iterations = pw.iterations;
  customer.hash = pw.hash;
  await putCustomer(customer, env);

  const sessionToken = await makeCustomerSession(customer, env);
  // App clients get the token in the body (Bearer auth) — see signin.js.
  const wantsToken = request.headers.get('X-Client') === 'app';
  return new Response(JSON.stringify({ user: publicProfile(customer), ...(wantsToken ? { token: sessionToken } : {}) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': customerCookieHeader(sessionToken),
    },
  });
};

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
