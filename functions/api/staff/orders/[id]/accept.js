/* POST /api/staff/orders/:id/accept — staff accepts an order and sets a
   ready time. Sends the customer the second confirmation email. */
import { requireStaff, resolveSession } from '../../../../_lib/auth.js';
import { getConfig } from '../../../../_lib/config.js';
import { getOrder, putOrder } from '../../../../_lib/kv.js';
import { sendEmail, orderAcceptedEmail } from '../../../../_lib/email.js';
import { sendOrderPush } from '../../../../_lib/push.js';

export const onRequestPost = async ({ request, env, params }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  const sess = await resolveSession(request, env);

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
  order.history.push({ at: new Date().toISOString(), event: 'accepted', readyAt, ...(sess?.name ? { by: sess.name } : {}) });
  await putOrder(order, env);

  const config = getConfig();
  const mail = orderAcceptedEmail(order, config);
  await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html, fromName: mail.fromName }, env);

  // Customer-app push (no-op unless the order carries an app device token).
  // Best-effort like the email — an FCM hiccup must never fail the accept.
  try {
    await sendOrderPush(order, {
      title: config.business?.shortName || config.business?.tradingName || 'Your order',
      body: `Order accepted — ready around ${localHHMM(readyAt, config)}.`,
    }, env);
  } catch (e) {
    console.warn('accept push failed', e);
  }

  return Response.json({ order });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ISO timestamp -> "18:45" in the shop's timezone for the push copy.
function localHHMM(iso, config) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: config.ordering?.timezone || 'Europe/London',
    }).format(new Date(iso));
  } catch { return ''; }
}
