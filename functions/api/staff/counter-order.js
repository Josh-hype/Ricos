/* POST /api/staff/counter-order — record an in-person till sale (PIN-gated).
   The till is the EPOS Sale view: staff tap items, take payment at the
   counter, and submit here. The client sends item ids + qty + modifiers,
   NEVER prices — we recompute totals from the canonical menu so the till
   can't be tampered with into selling at the wrong price.

   The order is persisted with status='accepted' and payment.state='paid' so
   it lands on Live (already accepted — staff just took the payment, no
   second-stage accept dialog needed) and counts in Today / Z report
   alongside web orders. paymentMethod is 'counter_cash' for now; when the
   Stripe Terminal SDK lands for the Sunmi T2 reader, that'll grow a
   'counter_card' branch. */

import { requireStaff } from '../../_lib/auth.js';
import { getConfig } from '../../_lib/config.js';
import { computeTotals } from '../../_lib/totals.js';
import { putOrder, newOrderId } from '../../_lib/kv.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return err('Add at least one item before charging.', 400);

  const config = getConfig();
  // Counter sales are collection (handed over the counter); suppressPromo so
  // the 10% online discount doesn't apply in person.
  const totals = computeTotals(
    { items, fulfillment: 'collection' },
    config,
    { suppressPromo: true },
  );
  if (!totals.ok) return err(totals.reason, 400);

  // Default ready time uses the shop's ASAP prep, same as the website does
  // when staff don't pick a slot. Staff can still bump it later from Live.
  const prepMin = Math.max(5, Math.min(180, Number(config.ordering?.asapMinPrepMinutes) || 20));
  const at = new Date().toISOString();
  const readyAt = new Date(Date.now() + prepMin * 60000).toISOString();

  const id = newOrderId();
  const name = String(body.customerName || '').trim().slice(0, 60) || 'Counter sale';
  const order = {
    id,
    createdAt: at,
    status: 'accepted',
    source: 'counter',
    fulfillment: 'collection',
    schedule: 'asap',
    readyAt,
    customer: { name, email: '', phone: '' },
    address: null,
    totals,
    paymentMethod: 'counter_cash',
    payment: { state: 'paid', paidAt: at, tender: 'cash' },
    marketing: { email: false, sms: false },
    history: [
      { at, event: 'created', source: 'counter' },
      { at, event: 'paid', tender: 'cash' },
      { at, event: 'accepted', readyAt },
    ],
  };

  await putOrder(order, env);
  return Response.json({ order });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
