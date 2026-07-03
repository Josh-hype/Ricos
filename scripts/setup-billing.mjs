#!/usr/bin/env node
/* Set up LumiPOS weekly subscription billing — the PLATFORM (Lumin Labs) billing
   each shop a fixed weekly fee via Stripe Billing + Bacs Direct Debit.

   This is the platform's own revenue, NOT Stripe Connect: the shop is a normal
   Customer of the platform account (no Stripe-Account header). Stripe runs the
   weekly charge, retries and receipts — we only create the catalogue, the
   customers, and a Direct Debit mandate link for each shop to complete once.

   What it does (idempotent — safe to re-run):
     1. Ensures a weekly Price for each catalogue item (found by lookup_key).
     2. Ensures a Customer per shop (matched by email + metadata.lumipos_shop).
     3. If the shop has no active subscription yet, prints a Bacs Direct Debit
        Checkout link. The shop opens it, enters its bank details and signs the
        mandate; Stripe then creates the weekly subscription and starts charging.
        If a subscription already exists, it's reported and no link is made
        (so re-running never double-subscribes anyone).

   Prerequisites:
     - Bacs Direct Debit must be enabled on the PLATFORM Stripe account:
         Stripe Dashboard → Settings → Payment methods → Bacs Direct Debit → turn on.
     - The platform secret key for the mode you want:
         sk_test_… to rehearse (use Stripe's test sort code 20-00-00 / acct 55779911),
         sk_live_… to bill for real.

   Usage:
     STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-billing.mjs
     STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-billing.mjs ricos   # one shop

   Amounts are in PENCE and are the source of truth for what each shop pays. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Billing catalogue (weekly, GBP). lookup_key makes Prices idempotent. ───────
const CATALOGUE = {
  software: { name: 'LumiPOS Software',      amountP: 1000, lookup: 'lumipos_software_weekly' },
  hardware: { name: 'LumiPOS Till Hardware', amountP: 1500, lookup: 'lumipos_till_hardware_weekly' },
  terminal: { name: 'LumiPOS Card Terminal', amountP: 1000, lookup: 'lumipos_card_terminal_weekly' },
  // Food Station's agreed all-in weekly rate — a single combined line (£19),
  // not the itemised software+hardware breakdown, so it needs its own Price.
  fsWeekly: { name: 'LumiPOS Weekly (Food Station)', amountP: 1900, lookup: 'lumipos_food_station_weekly' },
};

// ── Who pays for what. Name/email/domain default from the shop's config.json. ──
const SHOPS = [
  { slug: 'ricos',        items: ['software', 'hardware', 'terminal'] }, // £35/wk
  { slug: 'food-station', items: ['fsWeekly'] },                         // £19/wk (agreed all-in rate)
];

const STRIPE_BASE = 'https://api.stripe.com/v1';
const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('Set STRIPE_SECRET_KEY (sk_test_… to rehearse, sk_live_… for real).'); process.exit(1); }
const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST';

// Optional single-shop filter.
const only = (process.argv[2] || '').trim();
const shops = only ? SHOPS.filter(s => s.slug === only) : SHOPS;
if (only && shops.length === 0) { console.error(`Unknown shop "${only}". Known: ${SHOPS.map(s => s.slug).join(', ')}`); process.exit(1); }

async function stripe(pathname, body, method = 'POST') {
  const res = await fetch(`${STRIPE_BASE}${pathname}`, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status} on ${method} ${pathname}`);
  return json;
}

function shopMeta(slug) {
  const cfgPath = path.join(repoRoot, 'data', 'shops', slug, 'config.json');
  const biz = (fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')).business : null) || {};
  return {
    name: biz.tradingName || slug,
    email: biz.email || '',
    domain: biz.domain || '',
  };
}

// Find-or-create the weekly Price for a catalogue item (Product made on demand).
async function ensurePrice(item) {
  const found = await stripe(`/prices?lookup_keys[]=${encodeURIComponent(item.lookup)}&active=true&limit=1&expand[]=data.product`, null, 'GET');
  if (found.data && found.data[0]) return found.data[0];
  const product = await stripe('/products', { name: item.name, 'metadata[lumipos_item]': item.lookup });
  const price = await stripe('/prices', {
    currency: 'gbp',
    unit_amount: String(item.amountP),
    'recurring[interval]': 'week',
    'recurring[interval_count]': '1',
    product: product.id,
    lookup_key: item.lookup,
    'metadata[lumipos_item]': item.lookup,
  });
  console.log(`  + created price ${price.id} — ${item.name} £${(item.amountP / 100).toFixed(2)}/wk`);
  return price;
}

// Find-or-create the platform Customer for a shop (matched by email + our tag).
async function ensureCustomer(slug, meta) {
  if (meta.email) {
    const list = await stripe(`/customers?email=${encodeURIComponent(meta.email)}&limit=100`, null, 'GET');
    const hit = (list.data || []).find(c => c.metadata?.lumipos_shop === slug);
    if (hit) return hit;
  }
  const cust = await stripe('/customers', {
    name: meta.name,
    ...(meta.email ? { email: meta.email } : {}),
    description: `LumiPOS subscription — ${meta.name}`,
    'metadata[lumipos_shop]': slug,
  });
  console.log(`  + created customer ${cust.id} — ${meta.name} <${meta.email || 'no email'}>`);
  return cust;
}

// Any subscription already running for this customer? (Don't double-subscribe.)
async function activeSubscription(customerId) {
  const subs = await stripe(`/subscriptions?customer=${customerId}&status=all&limit=100`, null, 'GET');
  const live = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];
  return (subs.data || []).find(s => live.includes(s.status)) || null;
}

(async () => {
  console.log(`LumiPOS billing setup — ${mode} mode`);
  if (mode === 'LIVE') console.log('⚠  LIVE: completed mandates will be charged for real, every week.\n');

  // 1) Catalogue first, so every shop reuses the same Prices.
  console.log('Catalogue (weekly):');
  const priceFor = {};
  for (const k of Object.keys(CATALOGUE)) {
    const p = await ensurePrice(CATALOGUE[k]);
    priceFor[k] = p.id;
    console.log(`  · ${CATALOGUE[k].name.padEnd(24)} ${p.id}  £${(CATALOGUE[k].amountP / 100).toFixed(2)}`);
  }

  // 2) Per shop: customer, then a mandate link (or report the existing sub).
  const links = [];
  for (const shop of shops) {
    const meta = shopMeta(shop.slug);
    const totalP = shop.items.reduce((a, k) => a + CATALOGUE[k].amountP, 0);
    console.log(`\n${meta.name} (${shop.slug}) — ${shop.items.join(' + ')} = £${(totalP / 100).toFixed(2)}/wk`);
    if (!meta.email) console.log('  ! no business.email in config — Stripe needs an email for the DD mandate; add one or set it on the Customer.');

    const cust = await ensureCustomer(shop.slug, meta);
    const existing = await activeSubscription(cust.id);
    if (existing) {
      console.log(`  ✓ already subscribed: ${existing.id} (${existing.status}) — no new link.`);
      continue;
    }

    const ret = meta.domain ? `https://${meta.domain}/` : 'https://dashboard.stripe.com/';
    const body = {
      mode: 'subscription',
      customer: cust.id,
      'payment_method_types[0]': 'bacs_debit',
      billing_address_collection: 'auto',
      success_url: `${ret}?lumipos_billing=active`,
      cancel_url: ret,
      'subscription_data[metadata][lumipos_shop]': shop.slug,
      'subscription_data[description]': `LumiPOS weekly — ${meta.name}`,
    };
    shop.items.forEach((k, i) => {
      body[`line_items[${i}][price]`] = priceFor[k];
      body[`line_items[${i}][quantity]`] = '1';
    });
    const session = await stripe('/checkout/sessions', body);
    console.log(`  → Direct Debit setup link (send to the shop, valid ~24h):\n    ${session.url}`);
    links.push({ shop: meta.name, total: totalP, url: session.url });
  }

  if (links.length) {
    console.log('\n────────────────────────────────────────────────────────');
    console.log('Send each shop its link. They enter bank details + sign the Bacs');
    console.log('mandate once; Stripe then creates the weekly subscription and the');
    console.log('first payment clears in ~3–5 working days, then every week after.');
    for (const l of links) console.log(`  ${l.shop}: £${(l.total / 100).toFixed(2)}/wk → ${l.url}`);
  }
  console.log('\nDone.');
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
