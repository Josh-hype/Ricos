/* POST /api/marketing/subscribe — for the standalone footer signup form on
   the landing page. (Checkout opt-ins are recorded automatically by /api/order.) */
import { recordOptIn } from '../../_lib/kv.js';
import { normalisePhoneE164UK } from '../../_lib/sms.js';

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  const phone = normalisePhoneE164UK(body.phone || '');

  if (!email && !phone) return j({ error: 'Provide an email or UK mobile number.' }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ error: 'Invalid email.' }, 400);

  if (email) await recordOptIn({ kind: 'email', value: email, source: 'footer' }, env);
  if (phone) await recordOptIn({ kind: 'sms', value: phone, source: 'footer' }, env);

  return Response.json({ ok: true });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
