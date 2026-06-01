/* POST /api/staff/device-setup — verify a till's setup password before the app
   provisions this device to the shop. This gates DEVICE onboarding (it replaces the
   "type the shop's site URL" step in the app): the app resolves a 6-digit Restaurant
   ID to this backend, then proves it's an authorised till by sending the shop's setup
   password here. Per-OPERATOR PINs still gate staff actions afterwards — this is a
   separate, one-time, device-level check.

   The password is the per-shop secret env.TILL_SETUP_PASSWORD (set in Cloudflare,
   different per shop). If it's unset, password setup is disabled (the app falls back
   to entering the site address) — so an unconfigured shop can never be onboarded by a
   blank password. Best-effort per-IP rate limit via STAFF_LOGIN_KV, mirroring login.js. */

const enc = new TextEncoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time compare of two equal-length hex digests (no early-exit / length leak).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid request.' }, 400); }
  const password = String(body.password || '');

  const expected = env.TILL_SETUP_PASSWORD || '';
  if (!expected) {
    return j({ error: 'Password setup is not configured for this shop yet.' }, 503);
  }

  // Throttle brute-force on the setup password (best-effort; skipped if KV unbound).
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `setup-attempts:${ip}`;
  if (env.STAFF_LOGIN_KV) {
    const n = Number(await env.STAFF_LOGIN_KV.get(key)) || 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await env.STAFF_LOGIN_KV.put(key, String(n + 1), { expirationTtl: 600 });
  }

  // Compare SHA-256 digests in constant time (equal length, no early exit).
  const ok = timingSafeEqual(await sha256Hex(password), await sha256Hex(expected));
  if (!ok) return j({ error: 'Incorrect setup password.' }, 401);

  if (env.STAFF_LOGIN_KV) await env.STAFF_LOGIN_KV.delete(key); // clear the counter on success
  return j({ ok: true });
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
