/* Saved card management.

   GET    /api/account/payment-methods           — list saved cards
   DELETE /api/account/payment-methods?id=pm_xxx — detach the given card

   Cards are stored on the shop's Stripe Connect account, attached to a
   Customer (cus_xxx) we lazy-create on the user's first saved-card order.
   Both endpoints require an active customer session and a Stripe Customer
   ID on the KV record; otherwise we return an empty list / 404. */

import { getConfig } from '../../_lib/config.js';
import { resolveCustomerSession } from '../../_lib/customer-auth.js';
import { getCustomer } from '../../_lib/customer.js';
import { listPaymentMethods, detachPaymentMethod } from '../../_lib/stripe.js';

function projection(pm) {
  return {
    id: pm.id,
    brand:    pm.card?.brand    || 'card',
    last4:    pm.card?.last4    || '••••',
    expMonth: pm.card?.exp_month || null,
    expYear:  pm.card?.exp_year  || null,
  };
}

export const onRequestGet = async ({ request, env }) => {
  const session = await resolveCustomerSession(request, env);
  if (!session) return Response.json({ cards: [] });

  const customer = await getCustomer(session.contact, env);
  if (!customer?.stripeCustomerId) return Response.json({ cards: [] });

  const config = getConfig();
  const connectedAccountId = config.stripe?.connectedAccountId;
  if (!connectedAccountId || connectedAccountId === 'TBD') {
    return Response.json({ cards: [] });
  }

  try {
    const list = await listPaymentMethods(customer.stripeCustomerId, connectedAccountId, env);
    const cards = (list.data || []).map(projection);
    return Response.json({ cards });
  } catch (e) {
    console.error('listPaymentMethods failed', e);
    return Response.json({ cards: [] });
  }
};

export const onRequestDelete = async ({ request, env }) => {
  const session = await resolveCustomerSession(request, env);
  if (!session) return errJson('Sign in required.', 401);

  const customer = await getCustomer(session.contact, env);
  if (!customer?.stripeCustomerId) return errJson('No saved cards.', 404);

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!/^pm_[A-Za-z0-9]+$/.test(id)) return errJson('Invalid card id.', 400);

  const config = getConfig();
  const connectedAccountId = config.stripe?.connectedAccountId;
  if (!connectedAccountId) return errJson('Card service unavailable.', 503);

  try {
    // Verify the PM belongs to this customer before detaching so an
    // attacker can't detach someone else's card with a guessed id.
    const list = await listPaymentMethods(customer.stripeCustomerId, connectedAccountId, env);
    const owned = (list.data || []).some(pm => pm.id === id);
    if (!owned) return errJson('Card not found.', 404);

    await detachPaymentMethod(id, connectedAccountId, env);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('detachPaymentMethod failed', e);
    return errJson("Couldn't remove that card. Please try again.", 502);
  }
};

function errJson(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
