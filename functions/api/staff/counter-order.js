/* POST /api/staff/counter-order — record an in-person till sale (PIN-gated).
   The till is the EPOS Sale view: staff tap items, take payment at the
   counter, and submit here. The client sends item ids + qty + modifiers
   plus a sale mode (walkin / collection / delivery) and any customer
   details — NEVER prices, so the till can't be tampered with into
   selling at the wrong price; we recompute totals from the canonical
   menu.

   Modes:
     walkin     — anonymous counter sale, fulfillment 'collection'
     collection — named pickup, fulfillment 'collection' (customer phone
                  so the kitchen can call when ready)
     delivery   — sent out, fulfillment 'delivery' (address validated via
                  resolveDelivery, delivery fee applied)

   The order is persisted with status='accepted' and payment.state='paid'
   so it lands on Live (already accepted — staff just took the payment,
   no second-stage accept dialog needed) and counts in Today / Z report
   alongside web orders. paymentMethod is 'counter_cash' for now; when
   the Stripe Terminal SDK lands for the Sunmi T2 reader, that'll grow a
   'counter_card' branch. */

import { resolveSession } from '../../_lib/auth.js';
import { requirePermission } from '../../_lib/permissions.js';
import { logAudit } from '../../_lib/audit.js';
import { getConfig } from '../../_lib/config.js';
import { computeTotals } from '../../_lib/totals.js';
import { resolveDelivery } from '../../_lib/delivery.js';
import { putOrder, newOrderId } from '../../_lib/kv.js';

const MODES = new Set(['walkin', 'collection', 'delivery']);

export const onRequestPost = async ({ request, env }) => {
  // A counter sale books real revenue — gate it on the `sell` permission (a
  // no-op in legacy mode) and audit it, like refunds/voids.
  const ctx = {};
  const denied = await requirePermission(request, env, 'sell', ctx);
  if (denied) return denied;
  const sess = await resolveSession(request, env);

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return err('Add at least one item before charging.', 400);

  const mode = MODES.has(body.mode) ? body.mode : 'walkin';
  const fulfillment = mode === 'delivery' ? 'delivery' : 'collection';
  // Tender: cash by default; 'card' records a sale paid by card on the shop's
  // existing machine (Stripe Terminal capture drops in here later).
  const tender = body.tender === 'card' ? 'card' : 'cash';
  const config = getConfig();

  // Customer. Walk-ins get a placeholder; collection / delivery need a name
  // and phone so the kitchen can chase if there's a problem.
  const rawName = String(body.customer?.name || '').trim().slice(0, 60);
  const rawPhone = String(body.customer?.phone || '').trim().slice(0, 30);
  const name = rawName || (mode === 'walkin' ? 'Walk-in' : '');
  if (mode !== 'walkin' && name.length < 2) return err('Customer name is required.', 400);
  if (mode !== 'walkin' && rawPhone.length < 6) return err('Customer phone is required.', 400);

  // Delivery: validate address + resolve fee via the same path the website uses.
  let address = null;
  let deliveryFeeP = null;
  if (mode === 'delivery') {
    if (!config.fulfillment.delivery.enabled) {
      return err('Delivery is not configured for this shop.', 400);
    }
    const dq = await resolveDelivery(body.address?.postcode, config);
    if (!dq.ok) return err(dq.reason, 400);
    deliveryFeeP = dq.feePence;
    const line1 = String(body.address?.line1 || '').trim().slice(0, 120);
    if (line1.length < 2) return err('Please enter a delivery address.', 400);
    address = {
      line1,
      line2: String(body.address?.line2 || '').trim().slice(0, 120),
      city: config.business.address.city,
      postcode: dq.postcode,
      notes: String(body.address?.notes || '').trim().slice(0, 280),
    };
  }

  // Counter sales pay menu price face-to-face — the 10% online discount
  // doesn't apply. Server still owns the maths.
  const totals = computeTotals(
    { items, fulfillment, deliveryAddress: address ? { postcode: address.postcode } : undefined },
    config,
    { suppressPromo: true, deliveryFeeP: deliveryFeeP ?? undefined },
  );
  if (!totals.ok) return err(totals.reason, 400);

  // Default ready time uses the shop's ASAP prep, same as the website does
  // when staff don't pick a slot. Staff can still bump it later from Live.
  const prepMin = Math.max(5, Math.min(180, Number(config.ordering?.asapMinPrepMinutes) || 20));
  const at = new Date().toISOString();
  const readyAt = new Date(Date.now() + prepMin * 60000).toISOString();

  const id = newOrderId();
  const order = {
    id,
    createdAt: at,
    status: 'accepted',
    source: `counter-${mode}`,
    fulfillment,
    schedule: 'asap',
    readyAt,
    customer: { name, email: '', phone: rawPhone },
    address,
    totals,
    paymentMethod: tender === 'card' ? 'counter_card' : 'counter_cash',
    payment: { state: 'paid', paidAt: at, tender },
    marketing: { email: false, sms: false },
    createdBy: sess?.op ? { id: sess.op, name: sess.name } : null,
    history: [
      { at, event: 'created', source: `counter-${mode}`, by: sess?.name || null },
      { at, event: 'paid', tender },
      { at, event: 'accepted', readyAt },
    ],
  };

  await putOrder(order, env);
  await logAudit(env, {
    op: ctx.operator?.id || null, opName: ctx.operator?.name || sess?.name || null,
    action: 'counter_sale', target: id,
    details: { mode, tender, totalP: totals.totalP },
  });
  return Response.json({ order });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
