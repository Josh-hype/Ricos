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
          ${order.totals.serviceFeeP ? `<tr><td>Service fee</td><td style="text-align:right">£${(order.totals.serviceFeeP/100).toFixed(2)}</td></tr>` : ''}
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

export function welcomeEmail({ name, contact }, config) {
  const tradingName = escapeHtml(config.business.tradingName);
  return {
    subject: `Welcome to ${tradingName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Welcome, ${escapeHtml(name.split(' ')[0])}!</h2>
        <p>Your ${tradingName} account is ready. Next time you order we'll
           remember your contact and delivery address so checkout's just two taps.</p>
        <p>You signed up with <strong>${escapeHtml(contact)}</strong>. If that wasn't you,
           reply to this email and we'll sort it out.</p>
        <p style="font-size:0.85em;color:#888;margin-top:24px">${tradingName}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
  };
}

export function passwordResetEmail({ name, resetUrl }, config) {
  const tradingName = escapeHtml(config.business.tradingName);
  return {
    subject: `${tradingName} — reset your password`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Reset your password</h2>
        <p>Hi ${escapeHtml(name.split(' ')[0])}, click the button below to choose a new password.
           The link expires in 1 hour.</p>
        <p style="margin:24px 0">
          <a href="${escapeHtml(resetUrl)}"
             style="display:inline-block;background:#b81f23;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:600">
            Choose a new password
          </a>
        </p>
        <p style="font-size:0.85em;color:#555">Or copy this link: <br>${escapeHtml(resetUrl)}</p>
        <p style="font-size:0.85em;color:#888;margin-top:24px">If you didn't ask for this, ignore this email — your password won't change.</p>
      </div>`,
  };
}

export function orderRejectedEmail(order, config, reason) {
  const ref = order.id.toUpperCase();
  const tradingName = escapeHtml(config.business.tradingName);
  const phone = escapeHtml(config.business.phone || '');
  const refundLine = order.paymentMethod === 'card'
    ? `<p>Your card payment will be refunded automatically within 5–10 working days.</p>`
    : '';
  const reasonLine = reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`
    : '';
  return {
    subject: `${tradingName} — order ${ref} couldn't be accepted`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Sorry, we couldn't accept your order</h2>
        <p>Hi ${escapeHtml(order.customer.name.split(' ')[0])}, the kitchen wasn't able to take order <strong>${ref}</strong> this time.</p>
        ${reasonLine}
        ${refundLine}
        <p>If you'd like to talk to us, call ${phone || 'the restaurant'} and we'll do what we can.</p>
        <p style="font-size:0.85em;color:#888;margin-top:24px">${tradingName}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
