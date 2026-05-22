/* POST /api/staff/orders/:id/accept — staff accepts an order and sets a
   ready time. Sends the customer the second confirmation email. */
import { requireStaff } from '../../../../_lib/auth.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';
import { sendEmail, orderAcceptedEmail } from '../../../../_lib/email.js';

export const onRequestPost = async ({ request, env, params }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const id = String(params.id || '').toUpperCase();
  const order = await getOrder(id, env);
  if (!order) return j({ error: 'Order not found.' }, 404);
  if (order.status !== 'pending_accept') {
    return j({ error: `Order is ${order.status}, can't accept.` }, 409);
  }

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  let readyAt;
  if (body.readyAt) {
    const d = new Date(body.readyAt);
    if (Number.isNaN(d.getTime())) return j({ error: 'Invalid readyAt.' }, 400);
    readyAt = d.toISOString();
  } else if (body.prepMinutes) {
    const m = Math.max(5, Math.min(180, Number(body.prepMinutes)));
    readyAt = new Date(Date.now() + m * 60000).toISOString();
  } else {
    return j({ error: 'Provide readyAt or prepMinutes.' }, 400);
  }

  order.status = 'accepted';
  order.readyAt = readyAt;
  order.history.push({ at: new Date().toISOString(), event: 'accepted', readyAt });
  await putOrder(order, env);

  const config = getConfig();
  const mail = orderAcceptedEmail(order, config);
  await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html, fromName: mail.fromName }, env);

  return Response.json({ order });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
