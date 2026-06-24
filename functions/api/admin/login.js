/* POST /api/admin/login — exchange the owner password for a session cookie.
   Rate-limited per IP if a KV is bound (STAFF_LOGIN_KV or ADMIN_KV); skipped if not. */
import { checkOwner, makeOwnerSession, ownerCookieHeader, ownerEnabled, csrfOriginCheck } from '../../_lib/admin-auth.js';

export const onRequestPost = async ({ request, env }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  if (!ownerEnabled(env)) return j({ error: 'Owner login is not configured.' }, 503);

  let body;
  try { body = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const kv = env.STAFF_LOGIN_KV || env.ADMIN_KV || null;
  const key = `owner-attempts:${ip}`;
  if (kv) {
    const raw = await kv.get(key);
    const n = raw ? Number(raw) : 0;
    if (n >= 8) return j({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
    await kv.put(key, String(n + 1), { expirationTtl: 600 });
  }

  if (!(await checkOwner(body.username, body.password, env))) {
    return j({ error: 'Wrong username or password.' }, 401);
  }
  if (kv) await kv.delete(key);

  const token = await makeOwnerSession(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': ownerCookieHeader(token) },
  });
};

function j(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
