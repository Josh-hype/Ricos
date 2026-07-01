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
  const cfg = getConfig();
  // Per-shop default when no Back-Office override is set.
  const dflt = cfg.pos && cfg.pos.defaultRouting;
  if (dflt === 'print' || dflt === 'kds' || dflt === 'both') return dflt;
  return (cfg.kds && cfg.kds.enabled) ? 'kds' : 'print';
}

// Does this shop auto-print a kitchen ticket for COUNTER/till sales? Default yes;
// a shop can set pos.printCounterOnAccept:false to print ONLY online orders (the
// counter sale still shows on the KDS). Online orders always follow `print` above.
export function printCounterOnAccept(config) {
  return !(config && config.pos && config.pos.printCounterOnAccept === false);
}

// Effective counter-print setting: the Back-Office toggle (KV) over the per-shop
// config default (pos.printCounterOnAccept). true ⇒ counter/till sales also print.
export async function getPrintCounter(env) {
  const v = await getSetting(env, 'print-counter');
  if (v === 'on') return true;
  if (v === 'off') return false;
  return printCounterOnAccept(getConfig());
}

export function routingFlags(mode) {
  return {
    routing: mode,
    print: mode === 'print' || mode === 'both',
    kds: mode === 'kds' || mode === 'both',
  };
}
