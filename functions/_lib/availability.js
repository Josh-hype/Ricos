/* Item availability — staff "86" a menu item when they run out of stock.

   Stored per shop in ORDERS_KV under a single key (no new binding needed). Each
   off item is one of:
     - 'manual'   : stays off until staff turn it back on.
     - 'tomorrow' : auto-restores at the next TRADING day (honours the shop's
                    businessDayStartHour via londonDay), so it comes back on its
                    own — no cron. Reads lazily drop expired 'tomorrow' entries.

   Item ids are the menu.json ids (shared with menu-visual.json). */

import { londonDay } from './kv.js';

const KEY = 'item-availability';

// Tomorrow's TRADING date (YYYY-MM-DD), shop-local. londonDay() already folds in
// businessDayStartHour, so +24h lands on the next trading day even for late shops.
function nextTradingDay() {
  return londonDay(new Date(Date.now() + 86400000).toISOString());
}

async function readRaw(env) {
  if (!env.ORDERS_KV) return {};
  try { return JSON.parse((await env.ORDERS_KV.get(KEY)) || '{}') || {}; }
  catch { return {}; }
}

// Drop expired 'tomorrow' entries (today has reached/passed untilDay).
function prune(raw) {
  const today = londonDay();
  const map = {};
  let changed = false;
  for (const [id, rec] of Object.entries(raw || {})) {
    if (rec && rec.mode === 'tomorrow' && rec.untilDay && today >= rec.untilDay) { changed = true; continue; }
    map[id] = rec;
  }
  return { map, changed };
}

// Currently-off items: { [itemId]: { mode, untilDay, since, name } }.
export async function getOffMap(env) {
  return prune(await readRaw(env)).map;
}

export async function getOffIds(env) {
  return new Set(Object.keys(await getOffMap(env)));
}

// Turn an item OFF. mode: 'tomorrow' (auto-restore next trading day) | 'manual'.
export async function setOff(env, itemId, mode, name) {
  if (!env.ORDERS_KV) return null;
  const { map } = prune(await readRaw(env));
  map[itemId] = {
    mode: mode === 'tomorrow' ? 'tomorrow' : 'manual',
    untilDay: mode === 'tomorrow' ? nextTradingDay() : null,
    since: new Date().toISOString(),
    name: name || null,
  };
  await env.ORDERS_KV.put(KEY, JSON.stringify(map));
  return map[itemId];
}

// Turn an item back ON (also prunes expired entries on the way through).
export async function setOn(env, itemId) {
  if (!env.ORDERS_KV) return;
  const { map } = prune(await readRaw(env));
  delete map[itemId];
  await env.ORDERS_KV.put(KEY, JSON.stringify(map));
}
