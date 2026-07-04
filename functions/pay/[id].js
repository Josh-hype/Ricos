/* GET /pay/:id — short, SMS-friendly redirect to an order's hosted Stripe
   Checkout link.

   We text customers this short branded URL (e.g. https://ricosyork.co.uk/pay/A3K9ZQ2)
   instead of the raw ~600-character Stripe Checkout URL, which SMS clients
   truncate/mangle (they only linkify part of it, so the tap opens a broken link).
   The full Stripe URL — including its #fragment, which Checkout needs — is stored
   on the order and preserved in the Location header here. */

import { getConfig } from '../_lib/config.js';
import { getOrder } from '../_lib/kv.js';

export const onRequestGet = async ({ params, env }) => {
  const id = String(params?.id || '').trim();
  const order = id ? await getOrder(id, env) : null;
  const link = order?.payment?.link;

  const target = link || homeUrl();
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'no-store' },
  });
};

function homeUrl() {
  const domain = getConfig().business?.domain || '';
  return domain ? `https://${domain}/` : '/';
}
