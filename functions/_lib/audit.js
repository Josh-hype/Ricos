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
  const rand = Math.random().toString(36).slice(2, 8);
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
  const list = await kv.list({ prefix: 'audit:', limit: 1000 });
  const out = [];
  for (const k of list.keys) {
    const ymd = k.name.slice(6, 16); // audit:YYYY-MM-DD:...
    if (ymd >= fromYmd && ymd <= toYmd) {
      const raw = await kv.get(k.name);
      if (raw) { try { out.push(JSON.parse(raw)); } catch {} }
    }
  }
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return out;
}
