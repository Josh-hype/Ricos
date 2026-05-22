/* Resend wrapper. Sends transactional email.

   `fromName` (optional) gets formatted as: "Display Name" <email@domain>
   so inboxes show the brand instead of the local part of the address. */

export async function sendEmail({ to, subject, html, text, replyTo, fromName }, env) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return { skipped: true };
  }
  const fromEmail = env.RESEND_FROM_EMAIL || 'orders@example.com';
  // Prefer fromName from the caller, then env override, then no display name.
  const displayName = fromName || env.RESEND_FROM_NAME || null;
  const from = displayName ? `"${displayName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
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

export function orderAcceptedEmail(order, config) {
  const ref = order.id.toUpperCase();
  const tradingName = config.business.tradingName;
  const tradingNameHtml = escapeHtml(tradingName);
  const phone = escapeHtml(config.business.phone || '');
  const domain = config.business.domain;
  const logoUrl = domain ? `https://${domain}/logo.png` : null;

  const tz = config.ordering?.timezone || 'Europe/London';
  const readyDate = new Date(order.readyAt);
  const readyTime = readyDate.toLocaleString('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit',
  });
  const readyDay = readyDate.toLocaleString('en-GB', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'short',
  });
  const minutesAway = Math.max(1, Math.round((readyDate.getTime() - Date.now()) / 60000));
  const verb = order.fulfillment === 'delivery'
    ? 'delivered to you'
    : 'ready for collection';

  const lines = order.totals.lines.map(l =>
    `<tr>
       <td style="padding:6px 0">${escapeHtml(l.qty)}× ${escapeHtml(l.name)}${l.spice ? ` <em style="color:#a8331a">— ${escapeHtml(l.spice)}</em>` : ''}${l.modifiers?.length ? ` <em style="color:#6b5e58">(${l.modifiers.map(escapeHtml).join(', ')})</em>` : ''}${l.meal ? ' <em style="color:#6b5e58">(meal)</em>' : ''}</td>
       <td style="padding:6px 0;text-align:right">£${(l.lineTotalP/100).toFixed(2)}</td>
     </tr>`
  ).join('');

  const addressBlock = order.fulfillment === 'delivery' && order.address
    ? `<p style="margin:4px 0;color:#6b5e58;font-size:0.92em">
         Delivering to: ${escapeHtml(order.address.line1)}${order.address.line2 ? `, ${escapeHtml(order.address.line2)}` : ''}, ${escapeHtml(order.address.postcode)}
       </p>`
    : '';

  return {
    subject: `${tradingName} — order ${ref} confirmed, ready in ${minutesAway} min`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#181210;background:#fffaeb;padding:24px;border-radius:16px">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:12px">
          <img src="${logoUrl}" alt="${tradingNameHtml}" width="120" height="120" style="border:0;display:inline-block" />
        </div>` : ''}

        <h1 style="font-size:1.6rem;text-align:center;margin:8px 0 4px;color:#c8261c">Order confirmed</h1>
        <p style="text-align:center;margin:0 0 18px">Thanks ${escapeHtml(order.customer.name.split(' ')[0])} - we're cooking now.</p>

        <div style="background:#fff5d8;border:2px solid #181210;border-radius:12px;padding:18px 16px;text-align:center;margin:0 0 18px">
          <div style="font-size:0.92em;color:#6b5e58;letter-spacing:0.05em;text-transform:uppercase">Ready in about</div>
          <div style="font-size:2.4rem;font-weight:700;line-height:1.1;margin:4px 0">${minutesAway} min</div>
          <div style="font-size:0.95em">Your order will be ${verb} at <strong>${readyTime}</strong>, ${readyDay}.</div>
        </div>

        <p style="margin:0 0 4px"><strong>Reference:</strong> ${ref}</p>
        ${addressBlock}

        <table style="width:100%;border-collapse:collapse;margin:14px 0 4px;font-size:0.95em">
          ${lines}
          <tr><td style="padding-top:8px;border-top:1px solid #d8cfc8">Subtotal</td><td style="padding-top:8px;border-top:1px solid #d8cfc8;text-align:right">£${(order.totals.subtotalP/100).toFixed(2)}</td></tr>
          ${order.totals.discountP ? `<tr><td>${escapeHtml(order.totals.discountLabel || 'Discount')}</td><td style="text-align:right">−£${(order.totals.discountP/100).toFixed(2)}</td></tr>` : ''}
          ${order.totals.deliveryFeeP ? `<tr><td>Delivery</td><td style="text-align:right">£${(order.totals.deliveryFeeP/100).toFixed(2)}</td></tr>` : ''}
          ${order.totals.serviceFeeP ? `<tr><td>Service fee</td><td style="text-align:right">£${(order.totals.serviceFeeP/100).toFixed(2)}</td></tr>` : ''}
          <tr><td style="padding-top:6px"><strong>Total</strong></td><td style="padding-top:6px;text-align:right"><strong>£${(order.totals.totalP/100).toFixed(2)}</strong></td></tr>
        </table>

        <p style="margin-top:22px;font-size:0.9em;color:#6b5e58">Allergens or running late? Call ${phone || 'the restaurant'}.</p>
        <p style="font-size:0.85em;color:#9a8e87;margin-top:14px">${tradingNameHtml}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
    fromName: tradingName,
  };
}

export function welcomeEmail({ name, contact }, config) {
  const tradingName = config.business.tradingName;
  const tradingNameHtml = escapeHtml(tradingName);
  return {
    subject: `Welcome to ${tradingName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Welcome, ${escapeHtml(name.split(' ')[0])}!</h2>
        <p>Your ${tradingNameHtml} account is ready. Next time you order we'll
           remember your contact and delivery address so checkout's just two taps.</p>
        <p>You signed up with <strong>${escapeHtml(contact)}</strong>. If that wasn't you,
           reply to this email and we'll sort it out.</p>
        <p style="font-size:0.85em;color:#888;margin-top:24px">${tradingNameHtml}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
    fromName: tradingName,
  };
}

export function passwordResetEmail({ name, resetUrl }, config) {
  const tradingName = config.business.tradingName;
  const tradingNameHtml = escapeHtml(tradingName);
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
        <p style="font-size:0.85em;color:#888;margin-top:24px">If you didn't ask for this, ignore this email — your password won't change. — ${tradingNameHtml}</p>
      </div>`,
    fromName: tradingName,
  };
}

export function orderRejectedEmail(order, config, reason) {
  const ref = order.id.toUpperCase();
  const tradingName = config.business.tradingName;
  const tradingNameHtml = escapeHtml(tradingName);
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
        <p style="font-size:0.85em;color:#888;margin-top:24px">${tradingNameHtml}, 49 Blossom Street, York, YO24 1AZ.</p>
      </div>`,
    fromName: tradingName,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
