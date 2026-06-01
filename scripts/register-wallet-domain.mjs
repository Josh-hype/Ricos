#!/usr/bin/env node
/* Register (and validate) an Apple Pay / Google Pay payment method domain
   on a shop's Stripe *connected* account.

   Why a script: this site uses Stripe Connect direct charges (the
   PaymentIntent is created on the connected account), so the wallet
   domain has to be registered against that connected account — not the
   platform. Doing it via the API with the Stripe-Account header is more
   reliable than hunting for the right toggle in the Connect dashboard.

   Prerequisites:
   - The domain association file must already be hosted and deployed at
       https://<domain>/.well-known/apple-developer-merchantid-domain-association
     (commit it under public/.well-known/ and deploy first), otherwise
     Apple Pay validation will fail.
   - You need the shop's Stripe *secret* key for the mode you're setting
     up (sk_test_... for test mode, sk_live_... for live).

   Usage:
     STRIPE_SECRET_KEY=sk_test_xxx node scripts/register-wallet-domain.mjs [slug] [domain]

   slug defaults to "ricos"; domain defaults to the shop's
   business.domain from its config.json. The connected account id is read
   from the shop config's stripe.connectedAccountId. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const slug = (process.argv[2] || 'ricos').trim();
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`Invalid slug "${slug}". Use lowercase letters, digits and dashes only.`);
  process.exit(1);
}
const cfgPath = path.join(repoRoot, 'data', 'shops', slug, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`No config at data/shops/${slug}/config.json`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const domain = (process.argv[3] || config.business?.domain || '').trim();
const connectedAccountId = config.stripe?.connectedAccountId;
const key = process.env.STRIPE_SECRET_KEY;

if (!key) { console.error('Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...)'); process.exit(1); }
if (!domain) { console.error('No domain - pass one as the 2nd arg or set business.domain in config'); process.exit(1); }
if (!connectedAccountId || connectedAccountId === 'TBD') {
  console.error('No stripe.connectedAccountId in config'); process.exit(1);
}

const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST';
console.log(`Registering wallet domain "${domain}" on ${connectedAccountId} (${mode} mode)…`);

const STRIPE_BASE = 'https://api.stripe.com/v1';
async function stripe(pathname, body, method = 'POST') {
  const res = await fetch(`${STRIPE_BASE}${pathname}`, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Account': connectedAccountId,
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe ${res.status}`);
  }
  return json;
}

try {
  // Is the domain already registered? (Re-running the script shouldn't error.)
  const existing = await stripe('/payment_method_domains?domain_name=' + encodeURIComponent(domain), null, 'GET');
  let pmd = existing.data && existing.data[0];

  if (!pmd) {
    pmd = await stripe('/payment_method_domains', { domain_name: domain });
    console.log(`Created payment method domain ${pmd.id}`);
  } else {
    console.log(`Domain already registered as ${pmd.id} — re-validating`);
    pmd = await stripe(`/payment_method_domains/${pmd.id}/validate`, {});
  }

  const line = (label, obj) =>
    console.log(`  ${label.padEnd(11)}: ${obj?.status || 'n/a'}${obj?.status_details?.error_message ? ' — ' + obj.status_details.error_message : ''}`);
  console.log('Wallet status for this domain:');
  line('Apple Pay',  pmd.apple_pay);
  line('Google Pay', pmd.google_pay);
  line('Link',       pmd.link);

  if (pmd.apple_pay?.status !== 'active') {
    console.log('\nApple Pay is not active yet. Most common cause: the');
    console.log('association file is not reachable at');
    console.log(`  https://${domain}/.well-known/apple-developer-merchantid-domain-association`);
    console.log('Host + deploy that file, then re-run this script.');
  } else {
    console.log('\nApple Pay active. Google Pay needs no file and should follow.');
  }
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
