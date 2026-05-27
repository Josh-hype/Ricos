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
  // Keep the live-orders index in step so the staff dashboard never has to scan.
  await syncActiveIndex(order, env);
}

export async function getOrder(id, env) {
  const raw = await env.ORDERS_KV.get(`orders:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const KITCHEN_VISIBLE_STATUSES = new Set([
  'pending_accept',     // paid (or cash) — waiting for staff to accept
  'accepted',           // staff accepted with a ready time
  'ready',              // collection-ready
  'out_for_delivery',   // driver out
]);

/* ---- Active-orders index --------------------------------------------------
   The staff dashboard polls every few seconds. Doing a KV list() on each poll
   is slow and burns the (free-tier) list quota, so instead we keep ONE key
   holding the live set of kitchen-visible orders. putOrder maintains it, so a
   poll is a single get() — no scan. To self-heal any drift (e.g. two orders
   created in the same instant racing the index write), the read path does a
   full rebuild from the authoritative order docs at most once per minute, so
   an order can never be permanently missing from the board. */
const ACTIVE_INDEX_KEY = 'index:active';
const ACTIVE_RECONCILE_MS = 60000;

async function readActiveIndex(env) {
  try {
    const raw = await env.ORDERS_KV.get(ACTIVE_INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// Incremental upsert/remove for one order. Never lists — uses the order object
// we already have in hand.
async function syncActiveIndex(order, env) {
  const idx = await readActiveIndex(env);
  const existing = idx && Array.isArray(idx.orders) ? idx.orders : [];
  let orders = existing.filter(o => o.id !== order.id);
  if (KITCHEN_VISIBLE_STATUSES.has(order.status)) orders.push(order);
  // Preserve the reconcile clock; if there was no index yet, force a rebuild on
  // the next read (rebuiltAt=0) so any pre-existing active orders get picked up.
  const rebuiltAt = idx && idx.rebuiltAt ? idx.rebuiltAt : 0;
  await env.ORDERS_KV.put(ACTIVE_INDEX_KEY, JSON.stringify({ rebuiltAt, orders }));
}

// Authoritative rebuild from the per-order docs. The only place that lists.
async function rebuildActiveIndex(env) {
  const list = await env.ORDERS_KV.list({ prefix: 'orders:', limit: 1000 });
  const active = [];
  for (const k of list.keys) {
    if (KITCHEN_VISIBLE_STATUSES.has(k.metadata?.status)) {
      const raw = await env.ORDERS_KV.get(k.name);
      if (raw) { try { active.push(JSON.parse(raw)); } catch {} }
    }
  }
  await env.ORDERS_KV.put(ACTIVE_INDEX_KEY, JSON.stringify({ rebuiltAt: Date.now(), orders: active }));
  return active;
}

export async function listActiveOrders(env) {
  const idx = await readActiveIndex(env);
  const fresh = idx && Array.isArray(idx.orders)
    && (Date.now() - (idx.rebuiltAt || 0)) <= ACTIVE_RECONCILE_MS;
  const orders = fresh ? idx.orders : await rebuildActiveIndex(env);
  return orders
    .filter(o => KITCHEN_VISIBLE_STATUSES.has(o.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
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
