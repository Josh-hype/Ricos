/* GET /api/staff/wallet-domain — register + validate this shop's web domain as
   a Stripe payment method domain on the connected account, so Apple Pay /
   Google Pay render in checkout (PIN-gated, idempotent).

   Connect direct charges require the domain to be registered on the CONNECTED
   account via the API — the Stripe Dashboard can't do it for direct-charge
   accounts. Hitting this once per shop (after the .well-known file is reachable)
   turns the wallets on. Safe to re-run: it reuses an existing registration and
   just re-validates. */
import { requireStaff } from '../../_lib/auth.js';
import { getConfig } from '../../_lib/config.js';
import {
  listPaymentMethodDomains,
  createPaymentMethodDomain,
  validatePaymentMethodDomain,
} from '../../_lib/stripe.js';

export const onRequestGet = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;

  const config = getConfig();
  const acct = config.stripe?.connectedAccountId;
  const domain = config.business?.domain;
  if (!acct || acct === 'TBD') return j({ error: 'No Stripe connected account configured for this shop.' }, 400);
  if (!domain) return j({ error: 'No business.domain set in this shop\'s config.' }, 400);

  try {
    const existing = await listPaymentMethodDomains(domain, acct, env);
    let pmd = existing?.data?.[0] || await createPaymentMethodDomain(domain, acct, env);
    const v = await validatePaymentMethodDomain(pmd.id, acct, env);
    return j({
      ok: true,
      domain,
      connectedAccountId: acct,
      id: v.id,
      enabled: v.enabled,
      applePay: v.apple_pay?.status || null,
      googlePay: v.google_pay?.status || null,
      link: v.link?.status || null,
      // status_details explains any "inactive" wallet (usually the .well-known
      // file not yet reachable on the domain).
      applePayDetails: v.apple_pay?.status_details || null,
      googlePayDetails: v.google_pay?.status_details || null,
    });
  } catch (e) {
    return j({ ok: false, error: e?.message || String(e), stripe: e?.stripe || null }, 502);
  }
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
