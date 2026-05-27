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

const KITCHEN_VISIBLE_STATUSES = new Set([
  'pending_accept',     // paid (or cash) — waiting for staff to accept
  'accepted',           // staff accepted with a ready time
  'ready',              // collection-ready
  'out_for_delivery',   // driver out
]);

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

const DONE_STATUSES = new Set(['completed', 'cancelled']);

// Finished orders (completed / cancelled), newest first. Staff history view —
// lets the kitchen re-open or reprint a recent order. We sort the lightweight
// key metadata first and only fetch the values for the page we return, so a
// long order history doesn't mean a huge fan-out of KV reads.
export async function listDoneOrders(env, { limit = 50 } = {}) {
  const list = await env.ORDERS_KV.list({ prefix: 'orders:', limit: 1000 });
  const recent = list.keys
    .filter(k => DONE_STATUSES.has(k.metadata?.status))
    .sort((a, b) => new Date(b.metadata?.createdAt || 0) - new Date(a.metadata?.createdAt || 0))
    .slice(0, limit);
  const out = [];
  for (const k of recent) {
    const raw = await env.ORDERS_KV.get(k.name);
    if (raw) { try { out.push(JSON.parse(raw)); } catch {} }
  }
  return out;
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
