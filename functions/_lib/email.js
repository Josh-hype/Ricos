/* Resend wrapper. Sends transactional email. */

export async function sendEmail({ to, subject, html, text, replyTo }, env) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || 'orders@example.com',
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Resend error', res.status, body);
    return { error: body };
  }
  return await res.json();
}

export function orderReceivedEmail(order, config) {
  const lines = order.totals.lines.map(l =>
    `<tr><td>${escapeHtml(l.qty)}× ${escapeHtml(l.name)}${l.modifiers?.length ? ` <em>(${l.modifiers.map(escapeHtml).join(', ')})</em>` : ''}${l.meal ? ' <em>(meal)</em>' : ''}</td><td style="text-align:right">£${(l.lineTotalP/100).toFixed(2)}</td></tr>`
  ).join('');
  const ref = order.id.toUpperCase();
  const tradingName = escapeHtml(config.business.tradingName);
  const phone = escapeHtml(config.business.phone || '');
  const fulfillment = order.fulfillment === 'delivery' ? 'delivery' : 'collection';
  return {
    subject: `${tradingName} — order ${ref} received`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Thanks ${escapeHtml(order.customer.name.split(' ')[0])}, we've got your order</h2>
        <p>Reference <strong>${ref}</strong> for ${fulfillment}. We'll send another email shortly with your ready time once the kitchen accepts it (usually within 5 minutes).</p>
        <table style="width:100%;border-collapse:collapse">
          ${lines}
          <tr><td>Subtotal</td><td style="text-align:right">£${(order.totals.subtotalP/100).toFixed(2)}</td></tr>
          ${order.totals.discountP ? `<tr><td>${escapeHtml(order.totals.discountLabel || 'Discount')}</td><td style="text-align:right">−£${(order.totals.discountP/100).toFixed(2)}</td></tr>` : ''}
          ${order.totals.deliveryFeeP ? `<tr><td>Delivery</td><td style="text-align:right">£${(order.totals.deliveryFeeP/100).toFixed(2)}</td></tr>` : ''}
          <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>£${(order.totals.totalP/100).toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin-top:24px;font-size:0.9em;color:#555">Allergens? Call ${phone || 'the restaurant'} before collecting.</p>
        <p style="font-size:0.85em;color:#888">${tradingName}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
  };
}

export function orderAcceptedEmail(order, config) {
  const ref = order.id.toUpperCase();
  const tradingName = escapeHtml(config.business.tradingName);
  const ready = new Date(order.readyAt).toLocaleString('en-GB', {
    timeZone: config.ordering.timezone,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const verb = order.fulfillment === 'delivery' ? 'delivered to you at' : 'ready for collection at';
  return {
    subject: `${tradingName} — order ${ref} confirmed for ${ready}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Confirmed — ${ready}</h2>
        <p>Your order <strong>${ref}</strong> will be ${verb} <strong>${ready}</strong>.</p>
        <p style="font-size:0.9em;color:#555">${tradingName}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
