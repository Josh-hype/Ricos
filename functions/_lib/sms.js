/* Twilio wrapper for SMS marketing list confirmations and ad-hoc messages.
   We do NOT send transactional SMS for every order by default — emails carry
   the order info. SMS is reserved for the marketing opt-in pipeline. */

export async function sendSms({ to, body }, env) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    console.warn('Twilio env not set — skipping SMS');
    return { skipped: true };
  }
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const params = new URLSearchParams({
    To: to,
    From: env.TWILIO_FROM_NUMBER,
    Body: body,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Twilio error', res.status, body);
    return { error: body };
  }
  return await res.json();
}

export function normalisePhoneE164UK(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+44') && digits.length === 13) return digits;
  if (digits.startsWith('07') && digits.length === 11) return `+44${digits.slice(1)}`;
  if (digits.startsWith('44') && digits.length === 12) return `+${digits}`;
  return null;
}
