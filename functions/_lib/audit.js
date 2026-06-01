/* Append-only audit log in STAFF_LOGIN_KV, keyed audit:<ymd>:<iso>-<rand>.
   Every sensitive action (sign-in, refund, void/cancel, discount, drawer-open,
   manager authorisation, operator changes) writes one immutable entry recording
   who did it, who approved it, when, and on which order. Entries self-prune
   after ~95 days. Writes never throw — auditing must not block the action. */

import { londonDay } from './kv.js';

export async function logAudit(env, entry) {
  const kv = env.STAFF_LOGIN_KV;
  if (!kv) return;
  const at = new Date().toISOString();
  const rand = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    await kv.put(`audit:${londonDay(at)}:${at}-${rand}`, JSON.stringify({ at, ...entry }), {
      expirationTtl: 95 * 24 * 3600,
    });
  } catch { /* best-effort */ }
}

// Audit entries within an inclusive London-day range, newest first.
export async function listAudit(env, fromYmd, toYmd) {
  const kv = env.STAFF_LOGIN_KV;
  if (!kv) return [];
  const out = [];
  // Paginate the whole audit prefix: a single 1000-key page dropped the NEWEST
  // entries (keys sort audit:YYYY-MM-DD:… so recent days come last), which is
  // exactly the data a manager investigating a recent incident wants.
  let cursor;
  do {
    const list = await kv.list({ prefix: 'audit:', limit: 1000, cursor });
    for (const k of list.keys) {
      const ymd = k.name.slice(6, 16); // audit:YYYY-MM-DD:...
      if (ymd >= fromYmd && ymd <= toYmd) {
        const raw = await kv.get(k.name);
        if (raw) { try { out.push(JSON.parse(raw)); } catch {} }
      }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return out;
}
