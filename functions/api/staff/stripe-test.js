/* GET /api/staff/stripe-test — Stripe config diagnostics.

   Reports whether STRIPE_SECRET_KEY is set (and its mode, live/test), the shop's
   connectedAccountId, and retrieves that connected account to show whether it's
   charge-ready — surfacing the exact Stripe error behind a pay-link "502".

   Access: a back-office session, OR a temporary ?key= token so the owner can run
   it from a browser while setting up a new shop. REMOVE the token once done.
   Safe: never returns secret values — only presence, key MODE (live/test), and
   Stripe's own (non-secret) account status / error messages. */

import { requireStaff } from '../../_lib/auth.js';
import { getConfig } from '../../_lib/config.js';

const DIAG_KEY = 'diag-4b8e1f6a9c2d7530'; // temporary; remove after setup

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== DIAG_KEY) {
    const denied = await requireStaff(request, env);
    if (denied) return denied;
  }

  const sk = env.STRIPE_SECRET_KEY || '';
  const pk = env.STRIPE_PUBLISHABLE_KEY || '';
  const config = getConfig();
  const acct = config.stripe?.connectedAccountId || '';

  const mode = (k, live, test) => (k.startsWith(live) ? 'LIVE' : k.startsWith(test) ? 'TEST' : k ? k.slice(0, 8) : null);
  const report = {
    STRIPE_SECRET_KEY: { set: !!sk, mode: mode(sk, 'sk_live_', 'sk_test_'), length: sk.length },
    STRIPE_PUBLISHABLE_KEY: { set: !!pk, mode: mode(pk, 'pk_live_', 'pk_test_') },
    STRIPE_WEBHOOK_SECRET: { set: !!env.STRIPE_WEBHOOK_SECRET },
  };
  const configReport = {
    connectedAccountId: acct || null,
    connectedAccountMode: acct ? 'live acct_ (LIVE keys required)' : null,
    stripeEnabled: config.payments?.stripeEnabled === true,
  };

  const hints = [];
  if (!sk) hints.push('STRIPE_SECRET_KEY is MISSING on this deployment — this is the usual cause of a pay-link 502. Add the shared platform secret key in Cloudflare (Production + Preview) and redeploy.');
  else if (!sk.startsWith('sk_live_') && !sk.startsWith('sk_test_') && !sk.startsWith('rk_')) hints.push('STRIPE_SECRET_KEY does not look like a Stripe secret key (expected sk_live_… / sk_test_…).');
  else if (sk.startsWith('sk_test_') && acct.startsWith('acct_')) hints.push('You have a TEST secret key but a LIVE connected account — they must match. Use the LIVE platform key.');
  if (!env.STRIPE_WEBHOOK_SECRET) hints.push('STRIPE_WEBHOOK_SECRET is missing — payments would take but orders would not reach the kitchen (the webhook promotes them). Set it too.');

  // Retrieve the connected account with the platform key → is it charge-ready?
  let account = null;
  if (sk && acct) {
    try {
      const res = await fetch(`https://api.stripe.com/v1/accounts/${acct}`, {
        headers: { Authorization: `Bearer ${sk}` },
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        account = {
          found: true,
          charges_enabled: j.charges_enabled,
          payouts_enabled: j.payouts_enabled,
          details_submitted: j.details_submitted,
          country: j.country,
          requirementsDue: (j.requirements?.currently_due || []).slice(0, 10),
        };
        account.diagnosis = j.charges_enabled
          ? 'Connected account is CHARGE-READY. If pay-link still 502s, re-check the key/webhook above and redeploy.'
          : 'The connected account exists but charges are NOT enabled — Stripe onboarding is incomplete. Finish onboarding (see requirementsDue) so it can take payments.';
      } else {
        account = { found: false, httpStatus: res.status, stripeCode: j.error?.code || null, stripeMessage: j.error?.message || null };
        if (res.status === 401) account.diagnosis = 'STRIPE_SECRET_KEY is invalid (401) — wrong/missing platform key on this deployment.';
        else if (/No such account/i.test(j.error?.message || '') || j.error?.code === 'account_invalid') account.diagnosis = 'This connected account is not visible to the key in use — usually a TEST key against a LIVE account (or the account belongs to a different platform). Use the LIVE platform key.';
      }
    } catch (e) {
      account = { found: false, networkError: String(e?.message || e) };
    }
  }

  return Response.json({ ok: true, env: report, config: configReport, hints, account }, { headers: { 'Cache-Control': 'no-store' } });
};
