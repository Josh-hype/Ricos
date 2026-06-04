/* Order routing — where accepted orders go for the kitchen:
     'print' → print a ticket on accept; the KDS shows nothing.
     'kds'   → show on the Kitchen Display; no printing.
     'both'  → print AND show on the display.
   Effective value = the KV override (set in Back Office) over the per-shop
   config default (config.kds.enabled ⇒ 'kds', else 'print'). A legacy on/off
   'kds-routing' key is still honoured so an earlier toggle isn't lost. */

import { getConfig } from './config.js';
import { getSetting } from './kv.js';

export async function getOrderRouting(env) {
  const v = await getSetting(env, 'order-routing');
  if (v === 'print' || v === 'kds' || v === 'both') return v;
  const legacy = await getSetting(env, 'kds-routing');
  if (legacy === 'on') return 'kds';
  if (legacy === 'off') return 'print';
  const cfg = getConfig().kds || {};
  return cfg.enabled ? 'kds' : 'print';
}

export function routingFlags(mode) {
  return {
    routing: mode,
    print: mode === 'print' || mode === 'both',
    kds: mode === 'kds' || mode === 'both',
  };
}
