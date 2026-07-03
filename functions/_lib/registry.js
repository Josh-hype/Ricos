/* Platform registry loader (Lumin Labs owner back-office).

   Unlike getConfig() — which reads the ONE active shop materialised at
   data/_active/ per deploy — the registry is platform-wide and committed, so
   we import it directly. It lists every venue, its Stripe Connect account, its
   online card processor, and what it pays Lumin Labs.

   It carries acct_… ids but NEVER secrets: the platform Stripe key is read
   from env at request time, not from here. */
import registry from '../../data/platform/registry.json';

export function getRegistry() {
  return registry;
}

export function getPlatform() {
  return registry.platform || {};
}

// Every shop in the registry (live and pending alike).
export function getShops() {
  return Array.isArray(registry.shops) ? registry.shops : [];
}

// Shops we can actually aggregate from Stripe — they have a real connected
// account (acct_…), not a blank/placeholder. A pending shop is surfaced in the
// UI but skipped when fanning out Stripe calls (it has nothing to read yet).
export function getConnectedShops() {
  return getShops().filter(s => /^acct_/.test(String(s.connectedAccountId || '')));
}

export function getShopBySlug(slug) {
  return getShops().find(s => s.slug === slug) || null;
}

export function getShopByAccount(acct) {
  if (!acct) return null;
  return getShops().find(s => s.connectedAccountId === acct) || null;
}

// Resolve a processor's fee rates. `channel` is 'online' or 'inPerson'.
// Falls back to Stripe, then to a safe zero-rate, so an unknown/placeholder
// processor key never throws — it just prices the cost line at £0 (and the UI
// can flag it). Returns { label, percent, fixedP }.
export function getProcessorRates(processorKey, channel = 'online') {
  const procs = registry.processors || {};
  const p = procs[processorKey] || procs.stripe || {};
  const band = (channel === 'inPerson' ? p.inPerson : p.online) || {};
  return {
    label: p.label || processorKey || 'unknown',
    percent: Number(band.percent) || 0,
    fixedP: Math.round(Number(band.fixedPence) || 0),
  };
}

// The per-order platform margin (pence) Lumin Labs takes on a shop's ONLINE
// orders — the shop's own override, else the platform default, else 50p.
export function perOrderFeeP(shop) {
  const override = shop && Number(shop.perOrderFeePence);
  if (override > 0) return Math.round(override);
  const dflt = Number(getPlatform().perOrderFeePence);
  return dflt > 0 ? Math.round(dflt) : 50;
}

// The platform margin (pence) on an IN-PERSON card payment through the till —
// shop override, else platform default, else 10p (the cardFeeP default the
// LumiPOS terminal flow actually charges as the application_fee).
export function perOrderFeeInPersonP(shop) {
  const override = shop && Number(shop.perOrderFeeInPersonPence);
  if (override > 0) return Math.round(override);
  const dflt = Number(getPlatform().perOrderFeeInPersonPence);
  return dflt > 0 ? Math.round(dflt) : 10;
}

// The weekly subscription (pence) a shop pays — shop override, else platform default.
export function subscriptionWeeklyP(shop) {
  const override = shop && shop.subscription && Number(shop.subscription.perWeekPence);
  if (override > 0) return Math.round(override);
  const dflt = Number(getPlatform().subscriptionPerWeekPence);
  return dflt > 0 ? Math.round(dflt) : 3500;
}
