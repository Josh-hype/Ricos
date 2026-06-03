/* POST /api/staff/terminal/charge — start a card payment on the counter reader
   (server-driven; e.g. BBPOS WisePOS E). Prices the sale server-side, creates a
   card_present PaymentIntent (manual capture) for that exact amount on the shop's
   connected account, finds the online reader, and tells it to collect.

   Returns { orderId, paymentIntentId, amountP, reader }. The till then polls
   /terminal/status and, once authorised, finalises via /counter-order (which
   re-verifies the amount and captures). The client never sends a price. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { priceCounterSale, cardFeeP } from '../../../_lib/counter-totals.js';
import { createPaymentIntent, listTerminalReaders, processPaymentIntentOnReader } from '../../../_lib/stripe.js';
import { newOrderId } from '../../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  const priced = await priceCounterSale({ items: body.items, mode: body.mode, address: body.address }, config);
  if (!priced.ok) return err(priced.error, 400);

  // Find the online counter reader.
  let readers;
  try { readers = await listTerminalReaders(acct, env); }
  catch (e) { return err('Could not reach the card reader service.', 502); }
  const online = (readers.data || []).filter((r) => r.status === 'online');
  if (online.length === 0) {
    return err('No card reader is online. Check the reader is powered on and connected.', 409);
  }
  const reader = online[0];

  // One PaymentIntent per attempt; mint the order id now so the PI metadata, the
  // reader action, and the eventual order all line up. The customer pays the plain
  // menu total; the platform's card fee (default 1.4% + 20p) is taken as the
  // Connect application_fee out of the shop's settlement — not added to the bill.
  const orderId = newOrderId();
  let pi;
  try {
    pi = await createPaymentIntent({
      amountP: priced.totals.totalP,
      currency: 'gbp',
      orderId,
      connectedAccountId: acct,
      applicationFeeP: cardFeeP(priced.totals.totalP, config),
      cardPresent: true,
    }, env);
  } catch (e) {
    return err('Could not start the card payment.', 502);
  }

  try {
    await processPaymentIntentOnReader(reader.id, pi.id, acct, env);
  } catch (e) {
    return err('The reader is busy or unavailable — try again.', 502);
  }

  return Response.json({
    orderId,
    paymentIntentId: pi.id,
    amountP: priced.totals.totalP,
    reader: { id: reader.id, label: reader.label || reader.device_type || 'Reader' },
  });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
