/* Tiny KV helpers. We use:
   - ORDERS_KV         keyed orders:<id>; metadata for index queries
   - MARKETING_KV      keyed email:<addr> / sms:<phone> for opt-in records
   - SLOTS_KV          keyed slot:<isoTimestamp>:count for capacity tracking */

import { getConfig } from './config.js';
import { getCustomer, putCustomer } from './customer.js';

export async function putOrder(order, env) {
  const key = `orders:${order.id}`;
  await env.ORDERS_KV.put(key, JSON.stringify(order), {
    metadata: {
      status: order.status,
      createdAt: order.createdAt,
      fulfillment: order.fulfillment,
      num: order.orderNumber || null, // short memorable number (for collision checks)
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
  if (order.marketing?.email && order.customer?.email) await recordOptIn({ kind: 'email', value: order.customer.email, source: 'checkout' }, env);
  if (order.marketing?.sms && order.customer?.phone) await recordOptIn({ kind: 'sms', value: order.customer.phone, source: 'checkout' }, env);
  // Count a first-orders promo redemption now that a card order is truly paid —
  // exactly once (the `counted` flag guards the webhook + client-confirm both
  // calling this). Deferring it to here means an abandoned/declined card payment
  // never consumes one of the customer's welcome-discount orders. Best-effort:
  // a KV hiccup here must not fail the payment promotion.
  if (order.promo?.firstOrders && !order.promo.counted && order.promo.contact) {
    try {
      const c = await getCustomer(order.promo.contact, env);
      if (c) {
        c.promoOrdersUsed = (Number(c.promoOrdersUsed) || 0) + 1;
        await putCustomer(c, env);
        order.promo.counted = true;
        await putOrder(order, env);
      }
    } catch (e) {
      console.warn('first-orders promo count failed', e);
    }
  }
  return true;
}

// Defence-in-depth before promoting an order to paid: the succeeded
// PaymentIntent must be this order's, in GBP, and cover at least the order
// total — so a stray/other PI carrying the same metadata.orderId (or a future
// code path) can't mark an order paid for the wrong amount.
export function paymentIntentMatchesOrder(pi, order) {
  if (!pi || !order) return false;
  const intentId = order.payment?.intentId;
  if (intentId && pi.id !== intentId) return false;
  if (String(pi.currency || 'gbp').toLowerCase() !== 'gbp') return false;
  const paid = Number(pi.amount_received ?? pi.amount ?? 0);
  return paid >= (order.totals?.totalP || 0);
}

// Total already refunded on an order (pence). Tolerant of the legacy single
// refund record so orders refunded before the partial-refund model still read.
export function refundedSoFar(order) {
  const p = order?.payment || {};
  if (typeof p.refundedTotalP === 'number') return p.refundedTotalP;
  if (p.refund?.state === 'succeeded' && p.refund.amountP) return p.refund.amountP;
  return 0;
}

// Append a refund to an order's record (pure — caller persists via putOrder).
// Supports multiple partial refunds; payment.state flips to 'refunded' once the
// order total is fully covered, otherwise 'partly_refunded'.
export function recordRefund(order, { amountP, reason, stripeId }) {
  order.payment = order.payment || {};
  order.payment.refunds = order.payment.refunds || [];
  // Idempotent: never count the same Stripe refund twice. Guards against a
  // retried/replayed call — or a re-read-then-record race — landing the same
  // refund id on the order more than once.
  if (stripeId && order.payment.refunds.some(r => r.stripeId === stripeId)) return;
  const at = new Date().toISOString();
  order.payment.refunds.push({ amountP, reason: reason || null, stripeId: stripeId || null, at });
  order.payment.refundedTotalP = refundedSoFar(order) + amountP;
  order.payment.state = order.payment.refundedTotalP >= (order.totals?.totalP || 0)
    ? 'refunded' : 'partly_refunded';
  order.history.push({ at, event: 'refund', amountP, ...(reason ? { reason } : {}) });
}

const KITCHEN_VISIBLE_STATUSES = new Set([
  'pending_accept',     // paid (or cash) — waiting for staff to accept
  'accepted',           // staff accepted with a ready time
  'ready',              // collection-ready
  'out_for_delivery',   // driver out
]);

// List EVERY key under `orders:`, paging through the cursor. KV caps a page at
// 1000, and a busy shop accumulates far more than that over time, so a single
// page would silently drop orders whose random id sorts past the page — which
// is exactly how a new order can fail to reach the board. We page until
// list_complete. Only key metadata is read here (no per-order value fetch).
async function listAllOrderKeys(env) {
  const keys = [];
  let cursor;
  do {
    const res = await env.ORDERS_KV.list({ prefix: 'orders:', limit: 1000, cursor });
    keys.push(...res.keys);
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return keys;
}

// Read straight from the per-order docs on each poll. We deliberately do NOT
// cache this in a single hot key: KV edge-caches a frequently-read key for up
// to 60s, which delayed new orders reaching the board. list() reflects fresh
// writes far quicker, and on the paid plan the list cost is negligible.
export async function listActiveOrders(env) {
  const keys = await listAllOrderKeys(env);
  const active = [];
  for (const k of keys) {
    const status = k.metadata?.status;
    if (status && KITCHEN_VISIBLE_STATUSES.has(status)) {
      const raw = await env.ORDERS_KV.get(k.name);
      if (raw) {
        try {
          const o = JSON.parse(raw);
          // Re-check the body status; the list metadata can briefly lag the
          // actual order doc and we don't want completed/cancelled orders to
          // leak onto Live in those windows.
          if (KITCHEN_VISIBLE_STATUSES.has(o.status)) active.push(o);
        } catch {}
      }
    }
  }
  // Newest first — the kitchen wants the latest order on the left.
  active.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return active;
}

export const DONE_STATUSES = new Set(['completed', 'cancelled']);

// The shop's TRADING day (YYYY-MM-DD), DST-safe. Normally the London calendar
// date, but a venue can set ordering.businessDayStartHour (e.g. 4 = 4am) so that
// a late-night shop's after-midnight orders still count toward the day it opened:
// anything before the rollover hour belongs to the PREVIOUS date. 0 / unset = a
// plain midnight-to-midnight calendar day (unchanged behaviour). Used everywhere
// "what day is this" matters — Today's takings, Z-report, completed orders, audit.
function londonHour(d) {
  // London wall-clock hour 0–23 (%24 guards the "24:00" some engines emit at midnight).
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false,
  }).format(d)) % 24;
}
function prevYmd(ymd) {
  const t = new Date(ymd + 'T12:00:00Z'); // noon UTC — clear of any TZ/DST edge
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
export function londonDay(iso = new Date().toISOString()) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const startHour = Number(getConfig().ordering?.businessDayStartHour) || 0;
  if (startHour <= 0) return date;
  return londonHour(d) >= startHour ? date : prevYmd(date);
}

// All orders created within an inclusive London-day range (YYYY-MM-DD strings),
// newest first. Filters on the lightweight key metadata first and only fetches
// the matching values, so we don't fan out a KV read for every order ever
// placed. Pages through every key so a high lifetime order count can't hide a day.
export async function listOrdersBetween(env, fromYmd, toYmd) {
  const keys = await listAllOrderKeys(env);
  const inRange = keys.filter(k => {
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
  if (!env.MARKETING_KV) {
    console.warn('recordOptIn: MARKETING_KV not bound — opt-in skipped');
    return;
  }
  const key = `${kind}:${value.toLowerCase()}`;
  await env.MARKETING_KV.put(key, JSON.stringify({
    value, source: source || null, optedInAt: new Date().toISOString(),
  }));
}

// Small shop-level settings (e.g. print⇄KDS routing), stored in ORDERS_KV under
// a `setting:` prefix so we don't need a new KV binding per shop.
export async function getSetting(env, key) {
  if (!env.ORDERS_KV) return null;
  return env.ORDERS_KV.get('setting:' + key);
}
export async function putSetting(env, key, value) {
  if (!env.ORDERS_KV) return;
  await env.ORDERS_KV.put('setting:' + key, String(value));
}

export function newOrderId() {
  // 7-char base32 (Crockford) — the order REFERENCE (KV key, Stripe metadata).
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const buf = crypto.getRandomValues(new Uint8Array(7));
  return [...buf].map(b => alphabet[b % alphabet.length]).join('');
}

// A short, memorable 3-digit order NUMBER (100–999) for the kitchen/counter to
// call out. Kept unique among currently-ACTIVE orders so two live tickets never
// share a number; completed orders' numbers are free to reuse. Falls back to a
// plain random number if the scan fails.
export async function nextOrderNumber(env) {
  const used = new Set();
  try {
    for (const k of await listAllOrderKeys(env)) {
      const m = k.metadata || {};
      if (m.num && m.status && KITCHEN_VISIBLE_STATUSES.has(m.status)) used.add(String(m.num));
    }
  } catch (e) { /* fall through to a plain random number */ }
  for (let i = 0; i < 60; i++) {
    const n = String(100 + Math.floor(Math.random() * 900));
    if (!used.has(n)) return n;
  }
  return String(100 + Math.floor(Math.random() * 900));
}
