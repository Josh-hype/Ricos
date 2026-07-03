/* "Pause online ordering" — a runtime switch controlled from the back office.

   Distinct from config.closures (a deploy-time, date-bounded FULL-day closure):
   this is a live toggle staff flip to stop taking ONLINE orders for the rest of
   the current trading day, then flip back to resume. It only gates the customer
   web checkout — counter/till sales are unaffected.

   Auto-resume: it's scoped to the trading day it was set on (via londonDay, which
   already folds in the shop's businessDayStartHour), so a shop that forgets to
   reopen isn't stuck closed — the next trading day reads as open again.

   Stored in ORDERS_KV under `setting:ordering-paused` as { day, at, by } (reusing
   the existing setting: prefix, so no new KV binding is needed). */

import { getSetting, putSetting, londonDay } from './kv.js';

const KEY = 'ordering-paused';

// → { paused: boolean, since?: iso, by?: name }. Paused only while the stored
// trading day is today's; a rolled-over day reads as open (auto-resume).
export async function getOrderingPause(env) {
  if (!env || !env.ORDERS_KV) return { paused: false };
  let rec = null;
  try { rec = JSON.parse((await getSetting(env, KEY)) || 'null'); } catch { rec = null; }
  if (!rec || !rec.day || rec.day !== londonDay()) return { paused: false };
  return { paused: true, since: rec.at || null, by: rec.by || null };
}

// Pause online ordering for the rest of today (paused=true) or resume (paused=false).
export async function setOrderingPause(env, paused, by) {
  if (!env || !env.ORDERS_KV) return { paused: false };
  if (paused) {
    const rec = { day: londonDay(), at: new Date().toISOString(), by: by || null };
    await putSetting(env, KEY, JSON.stringify(rec));
    return { paused: true, since: rec.at, by: rec.by };
  }
  // Resume: clear the marker (a null day reads as open).
  await putSetting(env, KEY, JSON.stringify({ day: null }));
  return { paused: false };
}
