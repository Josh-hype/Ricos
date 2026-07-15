/* GET /api/admin/clients  (owner-gated)

   The clients & billing view. Two honest, side-by-side sources:
     • registry  — what each shop IS and what it OWES Lumin Labs (the source of
                   truth: weekly fee, per-order fee, processor, Connect status).
     • Stripe    — the actual subscriptions + recent invoices on the platform
                   account (so you can see what's really been billed/paid).
   We don't fake a shop↔subscription join (Stripe subs aren't reliably tagged per
   shop yet); both lists are returned and the page shows them together. */
import { requireOwner } from '../../_lib/admin-auth.js';
import { getShops, getPlatform, subscriptionWeeklyP, perOrderFeeP, perOrderFeeInPersonP, getProcessorRates } from '../../_lib/registry.js';
import { listSubscriptions, listRecentInvoices } from '../../_lib/stripe-platform.js';

// Mask an acct id for display: acct_1TbeYBJXCn3TpBE3 → acct_…TpBE3.
const maskAcct = (a) => (/^acct_/.test(a || '') ? `acct_…${a.slice(-5)}` : '');

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireOwner(request, env);
  if (denied) return denied;

  const platform = getPlatform();
  const shops = getShops().map((s) => ({
    slug: s.slug,
    name: s.name,
    city: s.city || '',
    live: !!s.live,
    connected: /^acct_/.test(String(s.connectedAccountId || '')),
    accountMasked: maskAcct(s.connectedAccountId),
    onlineProcessor: getProcessorRates(s.onlineProcessor || 'stripe', 'online').label,
    subscriptionStatus: s.subscription?.status || (s.live ? 'active' : 'pending'),
    subscriptionVia: s.subscription?.via || 'stripe',
    perWeekP: subscriptionWeeklyP(s),
    perOrderFeeP: perOrderFeeP(s),
    perOrderFeeInPersonP: perOrderFeeInPersonP(s),
    since: s.subscription?.since || null,
  }));

  let stripeError = null;
  let subscriptions = [];
  let invoices = [];
  if (env.STRIPE_SECRET_KEY) {
    try {
      const subs = await listSubscriptions(env);
      subscriptions = (subs.data || []).map((s) => {
        // A sub can carry several line items (Rico's = software + hardware +
        // terminal, £35/wk total) — sum them all; showing items[0] alone made
        // Rico's read as £10/wk. Every item on a Stripe sub shares one billing
        // interval, so the first item's interval speaks for the total.
        const items = s.items?.data || [];
        const price = items[0]?.price || {};
        return {
          id: s.id,
          status: s.status,
          customer: s.customer?.name || s.customer?.email || s.customer?.id || s.customer || null,
          amountP: items.reduce((sum, it) => sum + (Number(it.price?.unit_amount) || 0) * (it.quantity || 1), 0),
          interval: price.recurring?.interval || null,
          intervalCount: price.recurring?.interval_count || 1,
          currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
        };
      });
    } catch (e) { stripeError = e.message || 'Stripe request failed'; }

    try {
      const inv = await listRecentInvoices(env, { limit: 40 });
      invoices = (inv.data || []).map((i) => ({
        id: i.id,
        number: i.number || null,
        status: i.status,
        customer: i.customer?.name || i.customer?.email || i.customer_name || i.customer || null,
        amountPaidP: Number(i.amount_paid) || 0,
        amountDueP: Number(i.amount_due) || 0,
        created: i.created ? new Date(i.created * 1000).toISOString() : null,
        url: i.hosted_invoice_url || null,
      }));
    } catch (e) { stripeError = stripeError || (e.message || 'Stripe request failed'); }
  } else {
    stripeError = 'STRIPE_SECRET_KEY is not set on this project.';
  }

  return Response.json({
    platform: { name: platform.name || 'Lumin Labs', owner: platform.owner || null },
    shops,
    subscriptions,
    invoices,
    stripeError,
    generatedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
