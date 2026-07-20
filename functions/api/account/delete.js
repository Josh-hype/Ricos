/* POST /api/account/delete — permanently delete the signed-in customer's
   account.

   Required by Apple App Review 5.1.1(v): an app that offers account creation
   must offer in-app account deletion — but it's exposed on the web account UI
   too (one shared template, and it's the right thing to do regardless).

   Deletes the KV customer record and detaches any saved cards from the shop's
   Stripe Connect account. Past ORDERS are kept — they're the shop's sales /
   accounting records, held under the order id, not the account. */

import { resolveCustomerSession, clearCustomerCookieHeader } from '../../_lib/customer-auth.js';
import { getCustomer } from '../../_lib/customer.js';
import { getConfig } from '../../_lib/config.js';
import { listPaymentMethods, detachPaymentMethod } from '../../_lib/stripe.js';
import { rateLimit } from '../../_lib/rate-limit.js';

export const onRequestPost = async ({ request, env }) => {
  const limited = await rateLimit(env, 'account-delete', request, 10);
  if (limited) return limited;

  const session = await resolveCustomerSession(request, env);
  if (!session) return errJson('Not signed in.', 401);

  const customer = await getCustomer(session.contact, env);
  if (!customer) return errJson('Account not found.', 404);

  // Detach saved cards first (best-effort — a Stripe hiccup must not leave the
  // account half-deleted and the customer stuck; the KV delete below is the
  // operation that matters).
  if (customer.stripeCustomerId) {
    const connectedAccountId = getConfig().stripe?.connectedAccountId;
    if (connectedAccountId && connectedAccountId !== 'TBD') {
      try {
        const list = await listPaymentMethods(customer.stripeCustomerId, connectedAccountId, env);
        for (const pm of list.data || []) {
          await detachPaymentMethod(pm.id, connectedAccountId, env);
        }
      } catch (e) {
        console.warn('detaching cards on account delete failed', e);
      }
    }
  }

  await env.CUSTOMERS_KV.delete(`customer:${customer.contact}`);

  // Deleting the record also kills every outstanding session (cookie AND app
  // Bearer token): verification re-reads the customer on each request and
  // fails when it's gone. Clearing the cookie here is just tidier UX.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCustomerCookieHeader(),
    },
  });
};

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
