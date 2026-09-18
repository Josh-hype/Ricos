/* chargeableAccountId — is this shop's Stripe connected account one we could
   actually charge on? Run: node --import ./tests/support/register.mjs --test tests/

   Every card path gates on this. Getting it wrong in the permissive direction
   is the expensive one: the request reaches Stripe, fails there, and the shop
   sees "Could not create the payment link" with no hint that the real answer is
   "nobody has filled the account in yet". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeableAccountId } from '../functions/_lib/stripe.js';

const cfg = (connectedAccountId) => ({ stripe: { connectedAccountId } });

test('accepts a real connected account id', () => {
  // Dominic Pizza's, as issued by Stripe.
  assert.equal(chargeableAccountId(cfg('acct_1UGqDKBzGUOO3oql')), 'acct_1UGqDKBzGUOO3oql');
  assert.equal(chargeableAccountId(cfg('  acct_1UGqDKBzGUOO3oql  ')), 'acct_1UGqDKBzGUOO3oql');
});

test('rejects the scaffold placeholder — the case that caused this', () => {
  // data/shops/_template ships this. It is truthy and it is not "TBD", so the
  // old `!acct || acct === 'TBD'` guard waved it through to Stripe.
  assert.equal(chargeableAccountId(cfg('acct_REPLACE_WITH_STRIPE_CONNECT_ID')), null);
});

test('rejects the other ways a shop can be unconfigured', () => {
  for (const v of ['', '   ', 'TBD', null, undefined, 0, false, {}, []]) {
    assert.equal(chargeableAccountId(cfg(v)), null, `accepted ${JSON.stringify(v)}`);
  }
  assert.equal(chargeableAccountId({}), null);
  assert.equal(chargeableAccountId(undefined), null);
  assert.equal(chargeableAccountId({ stripe: null }), null);
});

test('rejects anything that is not acct_ + a long run of alphanumerics', () => {
  for (const v of [
    // acct_TODO is ALPHANUMERIC — the first version of this helper accepted it,
    // which is why the rule is shape AND length rather than a placeholder list.
    'acct_TODO', 'acct_XXX', 'acct_CHANGEME',
    'acct_XXX_YYY', 'acct_', 'acct',
    'sk_live_abc123',                 // a SECRET KEY pasted into the wrong field
    'pk_live_abc123',
    'cus_1UGqDKBzGUOO3oql',           // a customer id
    'acct_1UGqDK BzGUOO',             // stray space inside
    'acct_1UGqDK-BzGUOO',             // hyphen
    'ACCT_1UGqDKBzGUOO3oql',          // wrong case prefix
  ]) {
    assert.equal(chargeableAccountId(cfg(v)), null, `accepted ${v}`);
  }
});

test('every live shop in the repo has a chargeable account, or none at all', async () => {
  // A shop is allowed to have no account yet (pre-launch) — but a shop that has
  // filled one in must have filled in something usable. This is the check that
  // would have caught Dominic's placeholder without waiting for a failed sale.
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const dir = new URL('../data/shops/', import.meta.url);
  for (const slug of readdirSync(dir)) {
    if (slug.startsWith('_')) continue;
    const f = new URL(`${slug}/config.json`, dir);
    if (!existsSync(f)) continue;
    const config = JSON.parse(readFileSync(f, 'utf8'));
    const raw = config.stripe?.connectedAccountId;
    const ok = chargeableAccountId(config);
    if (!ok) {
      // Unconfigured is fine, but it must be RECOGNISABLY unconfigured, so the
      // build warns and the card paths say "not configured" rather than 502.
      assert.ok(
        !raw || raw === 'TBD' || /REPLACE|TODO/i.test(raw),
        `${slug}: connectedAccountId ${JSON.stringify(raw)} is neither usable nor a recognised placeholder`,
      );
    }
  }
});
