/* Best-effort per-IP rate limiting via KV.

   Extracted from the staff login limiter (functions/api/staff/login.js) so the
   customer-facing routes (signin/signup/forgot-password, /api/order, order
   status/push) can share one implementation instead of forking the pattern.

   FIXED windows, not sliding: the key is time-bucketed
   (`rl:<bucket>:<ip>:<window>`), so the count resets every `ttlSeconds` no
   matter how steadily requests arrive. A refresh-on-every-hit TTL (the staff
   limiter's shape) never expires under steady traffic — the app's 30s order-
   tracking poll would climb to the cap in ~30 minutes and then black out.

   Uses STAFF_LOGIN_KV — the namespace that already holds login attempt
   counters on every shop project; the `rl:` prefix can't collide with the
   staff `attempts:<ip>` keys. KV is eventually consistent, so treat this as
   abuse damping, not a hard guarantee. If the namespace isn't bound the check
   is skipped (same best-effort stance as the staff limiter). */

export async function rateLimit(env, bucket, request, max, ttlSeconds = 600) {
  const kv = env.STAFF_LOGIN_KV;
  if (!kv) return null;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const win = Math.floor(Date.now() / (ttlSeconds * 1000));
  const key = `rl:${bucket}:${ip}:${win}`;
  const raw = await kv.get(key);
  const n = raw ? Number(raw) : 0;
  if (n >= max) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please try again in a few minutes.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }
  // TTL = window length + slack so the key outlives its window then vanishes.
  await kv.put(key, String(n + 1), { expirationTtl: ttlSeconds + 60 });
  return null;
}
