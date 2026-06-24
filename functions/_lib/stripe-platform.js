/* Platform-level Stripe reads for the Lumin Labs back-office.

   Uses the PLATFORM Stripe secret key (env.STRIPE_SECRET_KEY — the same shared
   key every shop project already uses). Two kinds of call:
     • platform-level (no Stripe-Account header): application_fees live on the
       PLATFORM account, as do the £35/wk subscriptions + their invoices.
     • connected-account (Stripe-Account: acct_…): a shop's own charges/volume.

   Read-only. Every list pages through `has_more` up to a sane cap and reports
   whether it was truncated, so a busy month never silently under-counts. */

const BASE = 'https://api.stripe.com/v1';
const MAX_PAGES = 20;          // 20 × 100 = up to 2,000 objects per list
const PAGE = 100;

async function get(path, env, { stripeAccount } = {}) {
  const headers = {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Stripe-Version': '2024-06-20',
  };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripe = json?.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Page a Stripe list endpoint. `base` is the path WITHOUT paging params and may
// already carry a query string. Returns { data, truncated }.
async function pageAll(base, env, opts = {}) {
  const out = [];
  let startingAfter = null;
  let truncated = false;
  const join = base.includes('?') ? '&' : '?';
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = `${base}${join}limit=${PAGE}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const res = await get(q, env, opts);
    const data = res.data || [];
    out.push(...data);
    if (!res.has_more || data.length === 0) return { data: out, truncated };
    startingAfter = data[data.length - 1].id;
    if (i === MAX_PAGES - 1) truncated = true;
  }
  return { data: out, truncated };
}

const created = (gte, lte) => {
  const p = [];
  if (gte) p.push(`created[gte]=${Math.floor(gte)}`);
  if (lte) p.push(`created[lte]=${Math.floor(lte)}`);
  return p.join('&');
};

/* Application fees = Lumin Labs' per-order revenue. PLATFORM-level: one paginated
   list covers EVERY shop. Each fee carries `.account` (the connected shop) and
   `.amount` / `.amount_refunded`, so this single call yields, per shop, the
   platform revenue collected AND the online card order count. */
export async function listApplicationFees(env, { gte, lte } = {}) {
  const qs = created(gte, lte);
  return pageAll(`/application_fees${qs ? `?${qs}` : ''}`, env);
}

// Group an application_fees list by connected account → { [acct]: {amountP, count} }.
export function groupFeesByAccount(fees) {
  const by = {};
  for (const f of fees) {
    const acct = f.account;
    if (!acct) continue;
    const net = (Number(f.amount) || 0) - (Number(f.amount_refunded) || 0);
    (by[acct] ||= { amountP: 0, count: 0 });
    by[acct].amountP += net;
    by[acct].count += 1;
  }
  return by;
}

/* A shop's own charges (gross merchandise volume). Connected-account call. We
   keep only succeeded, paid charges and split by card-present vs online so the
   processing-cost line can price each at the right rate. Returns
   { online:{count,grossP}, inPerson:{count,grossP}, refundedP, truncated }. */
export async function chargeVolumeForAccount(env, acct, { gte, lte } = {}) {
  const qs = created(gte, lte);
  const { data, truncated } = await pageAll(`/charges${qs ? `?${qs}` : ''}`, env, { stripeAccount: acct });
  const out = { online: { count: 0, grossP: 0 }, inPerson: { count: 0, grossP: 0 }, refundedP: 0, truncated };
  for (const c of data) {
    if (c.status !== 'succeeded' || !c.paid) continue;
    const gross = Number(c.amount_captured ?? c.amount) || 0;
    const refunded = Number(c.amount_refunded) || 0;
    out.refundedP += refunded;
    const present = c.payment_method_details?.type === 'card_present';
    const bucket = present ? out.inPerson : out.online;
    bucket.count += 1;
    bucket.grossP += gross - refunded;
  }
  return out;
}

/* Subscriptions on the PLATFORM account — the £35/wk shop fees, when billed via
   Stripe Billing. status='all' so paused/past_due/canceled show too. */
export async function listSubscriptions(env) {
  return pageAll('/subscriptions?status=all&expand[]=data.customer', env);
}

// Most recent invoices on the platform account (subscription payments + one-offs).
export async function listRecentInvoices(env, { limit = 50 } = {}) {
  // Single page, newest first — Stripe returns invoices in reverse-chronological order.
  const res = await get(`/invoices?limit=${Math.min(limit, 100)}&expand[]=data.customer`, env);
  return { data: res.data || [] };
}

// The platform's own Stripe balance — application fees accrue here (this is the
// money that has actually landed with Lumin Labs).
export async function retrievePlatformBalance(env) {
  return get('/balance', env);
}
