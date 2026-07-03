# tests/

Plain-Node unit tests (no framework, no deps) for the money/logic core. They run
the real `functions/_lib/*` modules — nothing is mocked except the KV namespace.

## Run

```sh
node --import ./tests/support/register.mjs --test tests/*.test.mjs
```

(or `npm test` once the script is added to package.json.)

## Why the loader

The `functions/_lib` modules `import` JSON (`config.json`, `menu.json`) without the
`with { type: 'json' }` attribute — Cloudflare's bundler rewrites those at deploy
time, but bare Node rejects them. `tests/support/loader.mjs` (registered by
`register.mjs`) does two test-only things:

1. permits attribute-less JSON imports, and
2. redirects `data/_active/{config,menu}.json` to `tests/fixtures/` so pricing and
   hours tests run against a **known synthetic shop** instead of whichever shop was
   last built into `data/_active/`.

None of this ships — it is imported only via the `--import` flag when running tests.

## Coverage

| File | Module under test | Notes |
|------|-------------------|-------|
| `totals.test.mjs` | `_lib/totals.js` | pricing authority: modifiers, meals, promo, delivery, service-fee split, qty clamp, custom/posOnly gates |
| `kv-refund.test.mjs` | `_lib/kv.js` | refund ledger + `paymentIntentMatchesOrder` (pure) |
| `hours.test.mjs` | `_lib/hours.js` | closures, late-start (date-parameterised) + slot invariants |
| `delivery.test.mjs` | `_lib/delivery.js`, `_lib/geocode.js` | outcode-mode fees + haversine (radius mode geocodes over the network, not unit-tested) |
| `postcode.test.mjs` | `_lib/postcode.js` | normalisation, allow-list, block-list |
| `availability.test.mjs` | `_lib/availability.js` | 86-list manual/tomorrow + lazy prune (fake KV) |
| `counter-totals.test.mjs` | `_lib/counter-totals.js` | counter pricing (promo/fee suppressed) + `cardFeeP` |

The pre-existing `test/auth.test.mjs` (session/HMAC) still runs standalone with
`node --test test/auth.test.mjs`.
