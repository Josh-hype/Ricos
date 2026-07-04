/* GET /api/staff/sms-test — Twilio SMS diagnostics (staff-gated).

   With no query      → reports whether the Twilio secrets are present on THIS
                        deployment, and the Account SID type (AC vs SK).
   With ?to=+447…      → also sends a real test SMS and returns Twilio's exact
                        HTTP status + error code/message, so a failure is visible.

   Safe: never returns secret values — only presence, lengths, the SID prefix,
   and the From number (which the operator already knows). */

import { requireStaff } from '../../_lib/auth.js';
import { normalisePhoneE164UK } from '../../_lib/sms.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const sid = env.TWILIO_ACCOUNT_SID || '';
  const token = env.TWILIO_AUTH_TOKEN || '';
  const from = env.TWILIO_FROM_NUMBER || '';

  const report = {
    TWILIO_ACCOUNT_SID: { set: !!sid, startsWith: sid ? sid.slice(0, 2) : null, length: sid.length },
    TWILIO_AUTH_TOKEN: { set: !!token, length: token.length },
    TWILIO_FROM_NUMBER: { set: !!from, value: from || null },
  };

  const hints = [];
  if (!sid) hints.push('TWILIO_ACCOUNT_SID is MISSING on this deployment — that alone explains zero Twilio logs. Re-add the secret in Cloudflare (Production + Preview) and redeploy.');
  else if (!sid.startsWith('AC')) hints.push(`TWILIO_ACCOUNT_SID starts with "${sid.slice(0, 2)}" — it must start with "AC" (the Account SID). If it starts with "SK" you pasted an API Key by mistake; that returns 401 and never logs a message.`);
  if (!token) hints.push('TWILIO_AUTH_TOKEN is MISSING on this deployment.');
  if (!from) hints.push('TWILIO_FROM_NUMBER is MISSING on this deployment.');
  else if (!/^\+/.test(from)) hints.push('TWILIO_FROM_NUMBER should be a Twilio number in +44… (E.164) format.');
  if (sid && token && from && hints.length === 0) hints.push('All three secrets are present and look well-formed. Add ?to=+447XXXXXXXXX to send a real test and see Twilio’s response.');

  let send = null;
  const toRaw = new URL(request.url).searchParams.get('to');
  if (toRaw) {
    const to = normalisePhoneE164UK(toRaw);
    if (!to) {
      send = { attempted: false, reason: `"${toRaw}" is not a valid UK mobile (expected 07… or +447…).` };
    } else if (!sid || !token || !from) {
      send = { attempted: false, reason: 'Cannot send — one or more Twilio secrets are not set (see env above).' };
    } else {
      const auth = btoa(`${sid}:${token}`);
      const params = new URLSearchParams({ To: to, From: from, Body: 'Test message from your ordering system — Twilio is working.' });
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const text = await res.text();
        let parsed = null; try { parsed = JSON.parse(text); } catch {}
        send = {
          attempted: true,
          to,
          ok: res.status >= 200 && res.status < 300,
          httpStatus: res.status,
          twilioCode: parsed?.code ?? null,
          twilioMessage: parsed?.message ?? (text ? text.slice(0, 400) : null),
          moreInfo: parsed?.more_info ?? null,
          messageSid: parsed?.sid ?? null,
        };
        if (res.status === 401) send.diagnosis = 'Twilio rejected the credentials (401). The Account SID and/or Auth Token in Cloudflare are wrong, or the SID is an API Key (SK…) instead of the Account SID (AC…).';
        else if (parsed?.code === 21606 || parsed?.code === 21612 || parsed?.code === 21659) send.diagnosis = 'The From number is not a valid Twilio SMS sender for this route. Check TWILIO_FROM_NUMBER is a Twilio-owned, SMS-capable +44 number.';
        else if (parsed?.code === 21608) send.diagnosis = 'Trial-account restriction — the destination number is unverified. Confirm the account is upgraded (paid).';
        else if (parsed?.code === 30007 || parsed?.code === 30034) send.diagnosis = 'Carrier filtered / sender not registered — you likely need UK A2P sender registration in Twilio.';
        else if (send.ok) send.diagnosis = 'SUCCESS — Twilio accepted the message. It will now appear in Monitor → Logs → Messaging. If it does not arrive on the handset, check Geo Permissions / carrier delivery.';
      } catch (e) {
        send = { attempted: true, to, networkError: String(e?.message || e) };
      }
    }
  }

  return Response.json(
    { ok: true, env: report, hints, send, usage: 'Append ?to=+447XXXXXXXXX to this URL to send a real test SMS.' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};
