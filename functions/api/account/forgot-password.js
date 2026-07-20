/* POST /api/account/forgot-password
   Body: { contact }
   Emails a reset link to whichever email address we have on file for the
   account. Always responds 200 (even when the contact isn't registered) so
   strangers can't probe which emails have accounts. */

import { normaliseContact, makeResetToken } from '../../_lib/customer-auth.js';
import { getCustomer } from '../../_lib/customer.js';
import { sendEmail, passwordResetEmail } from '../../_lib/email.js';
import { getConfig } from '../../_lib/config.js';
import { rateLimit } from '../../_lib/rate-limit.js';

export const onRequestPost = async ({ request, env, waitUntil }) => {
  // Generic OK response - leaks nothing about whether the contact exists.
  const ok = () => Response.json({ ok: true, message: "If we have an account for that contact and an email on file, we've sent you a reset link." });

  // Limit BEFORE any lookup: this route triggers outbound email, so an
  // unthrottled loop could spam a customer's inbox. A 429 leaks nothing about
  // whether the contact is registered.
  const limited = await rateLimit(env, 'forgot', request, 10);
  if (limited) return limited;

  if (!env.CUSTOMERS_KV || !env.SESSION_SECRET) return ok();

  let input;
  try { input = await request.json(); } catch { return ok(); }

  const contact = normaliseContact(input.contact);
  if (!contact) return ok();

  const customer = await getCustomer(contact.value, env);
  if (!customer || !customer.email) return ok();

  const token = await makeResetToken(customer, env);
  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  // Send in the background so a registered contact's response isn't slower than
  // an unregistered one (the email round-trip would otherwise leak existence).
  const mail = passwordResetEmail({ name: customer.name, resetUrl }, getConfig());
  const send = sendEmail({ to: customer.email, subject: mail.subject, html: mail.html, fromName: mail.fromName }, env)
    .catch((e) => console.warn('password reset email failed', e));
  if (typeof waitUntil === 'function') waitUntil(send); else await send;

  return ok();
};
