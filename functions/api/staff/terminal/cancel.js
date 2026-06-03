/* POST /api/staff/terminal/cancel — abort an in-progress card collection (the
   till's Cancel button or a timeout) and cancel the PaymentIntent so nothing is
   left authorised. Best-effort: we don't fail the caller if Stripe says there's
   nothing to cancel (the reader may have already finished or idled). */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { cancelReaderAction, cancelPaymentIntent } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const acct = getConfig().stripe?.connectedAccountId;
  const readerId = String(body.readerId || '');
  const piId = String(body.paymentIntentId || '');

  if (readerId) { try { await cancelReaderAction(readerId, acct, env); } catch (e) { /* nothing to cancel */ } }
  if (piId) { try { await cancelPaymentIntent(piId, acct, env); } catch (e) { /* already gone */ } }

  return Response.json({ ok: true });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
