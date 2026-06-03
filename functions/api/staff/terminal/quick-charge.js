/* POST /api/staff/terminal/quick-charge — take a manual card payment of an arbitrary
   amount on the counter reader (no cart). Staff type the amount on the till; we create a
   card_present PaymentIntent for exactly that, AUTO-captured (nothing to re-verify), and
   push it to the online reader. The till polls /terminal/status as usual; on succeeded
   the money is already captured — there's no order to finalise. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { cardFeeP } from '../../../_lib/counter-totals.js';
import { createPaymentIntent, listTerminalReaders, processPaymentIntentOnReader } from '../../../_lib/stripe.js';
import { newOrderId } from '../../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const amountP = Math.round(Number(body.amountP));
  if (!Number.isFinite(amountP) || amountP < 30) return err('Enter an amount of at least £0.30.', 400);
  if (amountP > 100000) return err('That amount looks too high (max £1000).', 400);

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

  let readers;
  try { readers = await listTerminalReaders(acct, env); }
  catch (e) { return err('Could not reach the card reader service.', 502); }
  const online = (readers.data || []).filter((r) => r.status === 'online');
  if (online.length === 0) return err('No card reader is online. Check it is powered on and connected.', 409);
  const reader = online[0];

  const orderId = newOrderId(); // reference only — used in the PI metadata for traceability
  let pi;
  try {
    pi = await createPaymentIntent({
      amountP,
      currency: 'gbp',
      orderId,
      connectedAccountId: acct,
      applicationFeeP: cardFeeP(amountP, config),
      cardPresent: true,
      captureMethod: 'automatic',
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
    paymentIntentId: pi.id,
    amountP,
    reader: { id: reader.id, label: reader.label || reader.device_type || 'Reader' },
  });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
