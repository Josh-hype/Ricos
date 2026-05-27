/* Tiny KV helpers. We use:
   - ORDERS_KV         keyed orders:<id>; metadata for index queries
   - MARKETING_KV      keyed email:<addr> / sms:<phone> for opt-in records
   - SLOTS_KV          keyed slot:<isoTimestamp>:count for capacity tracking */

export async function putOrder(order, env) {
  const key = `orders:${order.id}`;
  await env.ORDERS_KV.put(key, JSON.stringify(order), {
    metadata: {
      status: order.status,
      createdAt: order.createdAt,
      fulfillment: order.fulfillment,
    },
  });
}

export async function getOrder(id, env) {
  const raw = await env.ORDERS_KV.get(`orders:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Promote a paid card order into the kitchen queue. Idempotent — only acts on a
// pending_payment order. Shared by the Stripe webhook and the client-side
// confirm so the kitchen sees the order the instant payment succeeds, without
// waiting for webhook delivery.
export async function markOrderPaid(order, env) {
  if (!order || order.status !== 'pending_payment') return false;
  const at = new Date().toISOString();
  order.status = 'pending_accept';
  order.payment = order.payment || {};
  order.payment.state = 'paid';
  order.payment.paidAt = at;
  order.history.push({ at, event: 'paid' });
  await putOrder(order, env);
  if (order.marketing?.email) await recordOptIn({ kind: 'email', value: order.customer.email, source: 'checkout' }, env);
  if (order.marketing?.sms) await recordOptIn({ kind: 'sms', value: order.customer.phone, source: 'checkout' }, env);
  return true;
}

const KITCHEN_VISIBLE_STATUSES = new Set([
  'pending_accept',     // paid (or cash) — waiting for staff to accept
  'accepted',           // staff accepted with a ready time
  'ready',              // collection-ready
  'out_for_delivery',   // driver out
]);

// Read straight from the per-order docs on each poll. We deliberately do NOT
// cache this in a single hot key: KV edge-caches a frequently-read key for up
// to 60s, which delayed new orders reaching the board. list() reflects fresh
// writes far quicker, and on the paid plan the list cost is negligible.
export async function listActiveOrders(env, { limit = 100 } = {}) {
  const list = await env.ORDERS_KV.list({ prefix: 'orders:', limit });
  const active = [];
  for (const k of list.keys) {
    const status = k.metadata?.status;
    if (status && KITCHEN_VISIBLE_STATUSES.has(status)) {
      const raw = await env.ORDERS_KV.get(k.name);
      if (raw) {
        try { active.push(JSON.parse(raw)); } catch {}
      }
    }
  }
  active.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return active;
}

export const DONE_STATUSES = new Set(['completed', 'cancelled']);

// London calendar date (YYYY-MM-DD) — the shop's local day, DST-safe.
export function londonDay(iso = new Date().toISOString()) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

// All orders created within an inclusive London-day range (YYYY-MM-DD strings),
// newest first. Filters on the lightweight key metadata first and only fetches
// the matching values, so we don't fan out a KV read for every order ever
// placed. Caps the scan at 1000 keys (plenty for these shops' volumes).
export async function listOrdersBetween(env, fromYmd, toYmd) {
  const list = await env.ORDERS_KV.list({ prefix: 'orders:', limit: 1000 });
  const inRange = list.keys.filter(k => {
    const cd = k.metadata?.createdAt;
    if (!cd) return false;
    const d = londonDay(cd);
    return d >= fromYmd && d <= toYmd;
  });
  inRange.sort((a, b) => new Date(b.metadata.createdAt) - new Date(a.metadata.createdAt));
  const out = [];
  for (const k of inRange) {
    const raw = await env.ORDERS_KV.get(k.name);
    if (raw) { try { out.push(JSON.parse(raw)); } catch {} }
  }
  return out;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolve an inclusive {from,to} London-day range from request query params.
// Accepts ?date= (single day) or ?from=&?to=; defaults to today, and to=from
// when only one bound is given. Out-of-order bounds are swapped.
export function resolveDayRange(url) {
  const p = url.searchParams;
  const date = p.get('date');
  if (YMD_RE.test(date || '')) return { from: date, to: date };
  let from = YMD_RE.test(p.get('from') || '') ? p.get('from') : londonDay();
  let to = YMD_RE.test(p.get('to') || '') ? p.get('to') : from;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

export async function incrSlotCount(slotIso, env) {
  const key = `slot:${slotIso}`;
  const raw = await env.SLOTS_KV.get(key);
  const n = (raw ? Number(raw) : 0) + 1;
  await env.SLOTS_KV.put(key, String(n), { expirationTtl: 60 * 60 * 48 });
  return n;
}

export async function getSlotCount(slotIso, env) {
  const raw = await env.SLOTS_KV.get(`slot:${slotIso}`);
  return raw ? Number(raw) : 0;
}

export async function recordOptIn({ kind, value, source }, env) {
  if (!value) return;
  const key = `${kind}:${value.toLowerCase()}`;
  await env.MARKETING_KV.put(key, JSON.stringify({
    value, source: source || null, optedInAt: new Date().toISOString(),
  }));
}

export function newOrderId() {
  // 7-char base32 (Crockford) — readable on a printed receipt.
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const buf = crypto.getRandomValues(new Uint8Array(7));
  return [...buf].map(b => alphabet[b % alphabet.length]).join('');
}
