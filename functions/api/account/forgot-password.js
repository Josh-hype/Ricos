/* POST /api/account/forgot-password
   Body: { contact }
   Sends a reset link by whichever route we can reach the account on: email if we
   have one, otherwise SMS to the number they registered with. Customers who sign
   up with a phone number have no email on file, so before this they could never
   reset a forgotten password — the request succeeded and simply did nothing.
   Always responds 200 (even when the contact isn't registered) so strangers can't
   probe which contacts have accounts. */

import { normaliseContact, makeResetToken } from '../../_lib/customer-auth.js';
import { getCustomer } from '../../_lib/customer.js';
import { sendEmail, passwordResetEmail } from '../../_lib/email.js';
import { sendSms, normalisePhoneE164UK } from '../../_lib/sms.js';
import { getConfig } from '../../_lib/config.js';

export const onRequestPost = async ({ request, env, waitUntil }) => {
  // Generic OK response - leaks nothing about whether the contact exists.
  const ok = () => Response.json({ ok: true, message: "If we have an account for that contact, we've sent you a reset link." });

  if (!env.CUSTOMERS_KV || !env.SESSION_SECRET) return ok();

  let input;
  try { input = await request.json(); } catch { return ok(); }

  const contact = normaliseContact(input.contact);
  if (!contact) return ok();

  const customer = await getCustomer(contact.value, env);
  if (!customer) return ok();

  // Reach them however we can. Email is preferred (richer, free); a phone-only
  // account falls back to SMS on the number it registered with.
  const email = customer.email || (customer.contactType === 'email' ? customer.contact : '');
  const phone = normalisePhoneE164UK(customer.phone || (customer.contactType === 'phone' ? customer.contact : ''));
  if (!email && !phone) return ok();

  const config = getConfig();
  const token = await makeResetToken(customer, env);
  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  // Send in the background so a registered contact's response isn't slower than an
  // unregistered one (the round-trip would otherwise leak which contacts exist).
  let send;
  if (email) {
    const mail = passwordResetEmail({ name: customer.name, resetUrl }, config);
    send = sendEmail({ to: email, subject: mail.subject, html: mail.html, fromName: mail.fromName }, env)
      .catch((e) => console.warn('password reset email failed', e));
  } else {
    const shop = config.business?.tradingName || 'your account';
    send = sendSms({ to: phone, body: `${shop}: tap to set a new password — ${resetUrl}` }, env)
      .catch((e) => console.warn('password reset SMS failed', e));
  }
  if (typeof waitUntil === 'function') waitUntil(send); else await send;

  return ok();
};
