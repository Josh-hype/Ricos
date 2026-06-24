/* GET /api/admin/overview?range=today|7d|30d|90d|all  (owner-gated)

   The revenue dashboard's main feed. Aggregates straight from the Stripe
   PLATFORM API (the shared platform key sees every connected shop):
     • application_fees  → Lumin Labs' per-order revenue + online order count (one
                           platform-level list covers all shops)
     • charges/account   → each shop's gross volume (GMV), split online vs in-person
   then runs it through the processor-aware model (platform-revenue.js) to produce
   Lumin Labs revenue (subscription accrual + per-order fees) and the separate
   card-processing cost line (priced from each shop's CURRENT processor — Stripe
   today, Elavon later).

   Stripe failures degrade gracefully: the shops still render (from the registry)
   with a `stripeError` flag, rather than 500-ing the whole page. */
import { requireOwner } from '../../_lib/admin-auth.js';
import { getShops, getConnectedShops, getShopByAccount } from '../../_lib/registry.js';
import { listApplicationFees, groupFeesByAccount, chargeVolumeForAccount, retrievePlatformBalance } from '../../_lib/stripe-platform.js';
import { rollUp } from '../../_lib/platform-revenue.js';

// ms to add to UTC to reach London wall-clock (Workers run in UTC). The standard
// "format-as-London then re-parse-as-UTC" trick; good to the minute, DST-aware.
function londonOffsetMs(at) {
  return new Date(at.toLocaleString('en-US', { timeZone: 'Europe/London' })).getTime() - at.getTime();
}
function startOfLondonDay(at) {
  const off = londonOffsetMs(at);
  const wall = at.getTime() + off;
  return new Date(Math.floor(wall / 86400000) * 86400000 - off);
}
function ymdLondon(at) {
  return at.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function resolveRange(url) {
  const now = new Date();
  const today0 = startOfLondonDay(now);
  const DAY = 86400000;
  const r = (url.searchParams.get('range') || 'today').toLowerCase();
  let from;
  let label;
  if (r === '7d' || r === 'week') { from = new Date(today0.getTime() - 6 * DAY); label = 'Last 7 days'; }
  else if (r === '30d' || r === 'month') { from = new Date(today0.getTime() - 29 * DAY); label = 'Last 30 days'; }
  else if (r === '90d' || r === 'quarter') { from = new Date(today0.getTime() - 89 * DAY); label = 'Last 90 days'; }
  else if (r === 'all') { from = new Date('2025-01-01T00:00:00Z'); label = 'All time'; }
  else { from = today0; label = 'Today'; }
  return {
    key: r,
    label,
    fromSec: Math.floor(from.getTime() / 1000),
    toSec: Math.ceil(now.getTime() / 1000),
    fromYmd: ymdLondon(from),
    toYmd: ymdLondon(now),
  };
}

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireOwner(request, env);
  if (denied) return denied;

  const range = resolveRange(new URL(request.url));
  const allShops = getShops();
  const connected = getConnectedShops();

  let stripeError = null;
  let truncated = false;
  let feesByAccount = {};
  let volumeByAccount = {};
  let balance = null;

  if (env.STRIPE_SECRET_KEY) {
    try {
      // One platform-level list for every shop's per-order fees…
      const fees = await listApplicationFees(env, { gte: range.fromSec, lte: range.toSec });
      truncated = truncated || fees.truncated;
      feesByAccount = groupFeesByAccount(fees.data);

      // …and a per-shop charge-volume fetch, in parallel.
      const vols = await Promise.all(connected.map(async (s) => {
        try {
          const v = await chargeVolumeForAccount(env, s.connectedAccountId, { gte: range.fromSec, lte: range.toSec });
          return [s.connectedAccountId, v];
        } catch (e) {
          return [s.connectedAccountId, { error: e.message }];
        }
      }));
      for (const [acct, v] of vols) {
        volumeByAccount[acct] = v;
        if (v?.truncated) truncated = true;
      }

      try { balance = await retrievePlatformBalance(env); } catch { /* non-fatal */ }
    } catch (e) {
      stripeError = e.message || 'Stripe request failed';
    }
  } else {
    stripeError = 'STRIPE_SECRET_KEY is not set on this project.';
  }

  // Assemble per-shop facts for the revenue model. Every registry shop is
  // included (pending ones simply carry zeros).
  const shopStats = allShops.map((shop) => {
    const acct = shop.connectedAccountId;
    const fee = feesByAccount[acct] || { amountP: 0, count: 0 };
    const vol = volumeByAccount[acct] && !volumeByAccount[acct].error ? volumeByAccount[acct] : null;
    const channelSplit = vol
      ? { online: vol.online, inPerson: vol.inPerson }
      : { online: { count: fee.count, grossP: 0 }, inPerson: { count: 0, grossP: 0 } };
    // Order count: prefer real charge count; fall back to the application-fee count.
    const orderCount = vol ? (vol.online.count + vol.inPerson.count) : fee.count;
    const grossP = vol ? (vol.online.grossP + vol.inPerson.grossP) : 0;
    return {
      shop, orderCount, grossP, applicationFeesP: fee.amountP, channelSplit,
      // Diagnostics: how many fees/charges Stripe actually returned for this shop,
      // and any per-shop charge-list error — so a £0 row is explainable.
      feeCount: fee.count,
      chargeCount: vol ? (vol.online.count + vol.inPerson.count) : null,
      volumeError: (volumeByAccount[acct] && volumeByAccount[acct].error) || null,
    };
  });

  const { shops, totals } = rollUp(shopStats, { fromYmd: range.fromYmd, toYmd: range.toYmd });

  // The platform's own GBP balance (where application fees land).
  const gbp = (arr) => (arr || []).filter(b => b.currency === 'gbp').reduce((a, b) => a + (b.amount || 0), 0);
  const platformBalance = balance ? { availableP: gbp(balance.available), pendingP: gbp(balance.pending) } : null;

  return Response.json({
    range,
    totals,
    shops,
    platformBalance,
    truncated,
    stripeError,
    generatedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
