/* noPromo must survive the back-office menu editor.
   Run: node --import ./tests/support/register.mjs --test tests/

   THE BUG THIS PINS, from a real receipt on 18 Sep 2026:

     Mega Chippy · 1x BIG MEGA BOX
     Subtotal        25.90
     Service charge   1.00
     TOTAL          £23.01

   £26.90 of goods sold for £23.01 — the 15% welcome promo taken off a meal
   deal that carries noPromo in BOTH menu files. The flag was set correctly and
   the build's parity check passed; it was the EDITOR that lost it. None of the
   four transforms in menu-store.js copied noPromo, so the first menu edit a
   shop made dropped it off every item, and the KV doc is what the live site
   prices against.

   A shop had been selling bundles under the price of their parts for as long as
   its menu had been edited. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unifyStatic, validateUnified, deriveServerMenu, deriveVisualMenu,
} from '../functions/_lib/menu-store.js';
import { computeTotals } from '../functions/_lib/totals.js';
import { getConfig } from '../functions/_lib/config.js';

const SERVER = [{
  id: 'specials', name: 'Special Offers',
  items: [
    { id: 'big-mega-box', name: 'BIG MEGA BOX', priceP: 2590, noPromo: true },
    { id: 'cod-chips', name: 'Cod & Chips', priceP: 900 },
  ],
}];
const VISUAL = [{
  id: 'specials', name: 'Special Offers',
  items: [
    { id: 'big-mega-box', name: 'BIG MEGA BOX', price: 25.9, noPromo: true },
    { id: 'cod-chips', name: 'Cod & Chips', price: 9.0 },
  ],
}];

const findItem = (menu, id) =>
  menu.flatMap((c) => c.items || []).find((i) => i.id === id);

test('the full editor round trip keeps noPromo', () => {
  // static -> unified -> (save/normalise) -> server + visual, which is exactly
  // what happens the first time an owner opens the editor and presses save.
  const unified = unifyStatic(SERVER, VISUAL);
  assert.equal(findItem(unified.categories, 'big-mega-box').noPromo, true,
    'unifyStatic dropped it — the editor loses the flag on first save');

  const v = validateUnified(unified);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(findItem(v.doc.categories, 'big-mega-box').noPromo, true,
    'validateUnified dropped it — saving the menu loses the flag');

  assert.equal(findItem(deriveServerMenu(v.doc), 'big-mega-box').noPromo, true,
    'deriveServerMenu dropped it — the SERVER would discount the meal deal');
  assert.equal(findItem(deriveVisualMenu(v.doc), 'big-mega-box').noPromo, true,
    'deriveVisualMenu dropped it — the cart preview would quote a discount');

  // ...and an ordinary item must NOT acquire it.
  assert.equal(findItem(deriveServerMenu(v.doc), 'cod-chips').noPromo, undefined);
});

test('the receipt that started this: a deal-only basket gets no discount', () => {
  const menu = deriveServerMenu(validateUnified(unifyStatic(SERVER, VISUAL)).doc);
  const config = { ...getConfig(), serviceFeePence: 100 };
  const t = computeTotals(
    { items: [{ id: 'big-mega-box', qty: 1 }], fulfillment: 'collection' },
    config,
    { menu, firstOrderDiscount: { percent: 15, label: '15% off — first 2 orders' } },
  );
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.subtotalP, 2590);
  assert.equal(t.discountP, 0, `meal deal was discounted by £${(t.discountP / 100).toFixed(2)}`);
  assert.equal(t.totalP, 2690, 'should be £26.90 — the receipt said £23.01');
});

test('the promo still applies to everything that is not a deal', () => {
  const menu = deriveServerMenu(validateUnified(unifyStatic(SERVER, VISUAL)).doc);
  const config = { ...getConfig(), serviceFeePence: 100 };
  const t = computeTotals(
    { items: [{ id: 'big-mega-box', qty: 1 }, { id: 'cod-chips', qty: 2 }], fulfillment: 'collection' },
    config,
    { menu, firstOrderDiscount: { percent: 15, label: '15% off' } },
  );
  // 15% of the £18.00 of ordinary items only, never the £25.90 deal.
  assert.equal(t.subtotalP, 2590 + 1800);
  assert.equal(t.discountP, 270);
  assert.equal(t.totalP, 2590 + 1800 - 270 + 100);
});

test('a doc saved BEFORE the fix is healed on read', async () => {
  /* The repair path. Mega Chippy's stored doc has no noPromo anywhere — the
     information is gone from KV — so fixing the transforms alone would leave
     them discounting meal deals until someone re-saved the menu by hand.

     Built around an id the STATIC fixture actually flags, because the first
     version of this test guarded the assertion with `if (healed)` and the doc
     it built contained no flagged id at all: it passed against the unfixed
     code, which is the one thing a regression test must never do. */
  const { resolveMenu } = await import('../functions/_lib/menu-store.js');
  const { getMenu } = await import('../functions/_lib/menu.js');

  const staticItems = getMenu().flatMap((c) => c.items || []);
  const flaggedId = staticItems.find((i) => i.noPromo)?.id;
  const plainId = staticItems.find((i) => !i.noPromo)?.id;
  assert.ok(flaggedId, 'fixture menu has no noPromo item — this test cannot prove anything');
  assert.ok(plainId, 'fixture menu has no ordinary item to check against');

  // A stored doc exactly as the broken editor would have left it: both items
  // present, neither carrying the flag.
  const stripped = {
    version: 1,
    categories: [{
      id: 'specials', name: 'Special Offers',
      items: [
        { id: flaggedId, name: 'Flagged deal', priceP: 2590 },
        { id: plainId, name: 'Ordinary item', priceP: 900 },
      ],
    }],
  };
  const env = { ORDERS_KV: { get: async () => JSON.stringify(stripped), put: async () => {} } };
  const menu = await resolveMenu(env);

  assert.equal(findItem(menu, flaggedId)?.noPromo, true,
    `${flaggedId} is noPromo in the static menu and was NOT healed on read`);
  assert.equal(findItem(menu, plainId)?.noPromo, undefined,
    `${plainId} is an ordinary item and must not acquire noPromo`);
});

test('the heal does not leak a flag between items sharing a choice id', async () => {
  /* Choice ids are only unique WITHIN an item — they are g<group position>-<label>
     — so the Crust group second on a pizza and the one second on a two-pizza meal
     deal both yield "g2-thick". The first version of healChoiceFlags keyed on the
     choice id alone and pre-selected the DEAL's first crust (g2-thick) while
     leaving its second (g5-thick) on "Choose…", which is exactly what the shop
     reported. Nothing was mis-priced, because every flagged id happens to point
     at a £0.00 choice — but that is luck, not design. */
  const { resolveVisual } = await import('../functions/_lib/menu-store.js');

  const flagged = {   // an ordinary pizza: g2-thick IS the default
    id: 'pizza-margherita', name: 'Margherita', price: 8.2,
    options: [{ id: 'g2-crust', label: 'Crust', select: 'single', required: true,
      choices: [{ id: 'g2-thick', label: 'Thick', price: 0, posDefault: true },
                { id: 'g2-stuffed', label: 'Stuffed', price: 2.1 }] }],
  };
  const deal = {      // a deal: same choice id, and it must NOT inherit the flag
    id: 'special-offers-meal-deal-4', name: 'Meal Deal 4', price: 28,
    options: [{ id: 'g2-crust', label: 'Crust', select: 'single', required: true,
      choices: [{ id: 'g2-thick', label: 'Thick', price: 0 },
                { id: 'g2-stuffed', label: 'Stuffed', price: 3.8 }] }],
  };
  const staticVisual = [{ id: 'pizza', name: 'Pizza', items: [flagged] },
                        { id: 'so', name: 'Special Offers', items: [deal] }];
  // The stored doc: same shape, every flag stripped, as the old editor left it.
  const stored = JSON.parse(JSON.stringify({ version: 1, categories: staticVisual }))
    .categories.map((c) => ({ ...c, items: c.items.map((it) => ({
      ...it, priceP: Math.round(it.price * 100),
      options: it.options.map((g) => ({ ...g,
        choices: g.choices.map(({ posDefault, ...ch }) => ({ ...ch, priceP: Math.round(ch.price * 100) })) })) })) }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => staticVisual });
  try {
    const out = await resolveVisual(
      { ORDERS_KV: { get: async () => JSON.stringify({ version: 1, categories: stored }), put: async () => {} } },
      { url: 'https://example.co.uk/api/menu-visual' });
    const pick = (id) => out.flatMap((c) => c.items).find((i) => i.id === id)
      .options[0].choices.find((c) => c.id === 'g2-thick');
    assert.equal(pick('pizza-margherita').posDefault, true, 'the pizza lost its own default');
    assert.equal(pick('special-offers-meal-deal-4').posDefault, undefined,
      'the deal INHERITED the pizza’s default via a shared choice id');
  } finally { globalThis.fetch = realFetch; }
});
