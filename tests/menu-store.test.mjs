/* Menu editor store: the derive/validate/unify logic that guarantees the price
   SHOWN can never differ from the price CHARGED (both shapes come from one doc).
   Run: node --import ./tests/support/register.mjs --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveServerMenu, deriveVisualMenu, unifyStatic, validateUnified, slugify,
} from '../functions/_lib/menu-store.js';

const SERVER = [
  { id: 'drinks', name: 'Drinks', items: [
    { id: 'coke', name: 'Can of Coke', priceP: 155 },
    { id: 'combo', name: 'Combo', priceP: 990, mealAddP: 0,
      mealChoose: [{ category: 'drinks', label: 'Drink', count: 2 }],
      modifiers: [{ id: 'extra-dip', label: 'Extra dip', priceDeltaP: 50 }] },
  ] },
];
const VISUAL = [
  { id: 'drinks', name: 'Drinks', icon: '🥤', items: [
    { id: 'coke', name: 'Can of Coke', price: 1.55, desc: '330ml' },
    { id: 'combo', name: 'Combo', price: 9.90, meal: { label: 'Included', addPrice: 0, forced: true, choose: [{ category: 'drinks', label: 'Drink', count: 2 }] },
      options: [{ id: 'add', label: 'Add', select: 'multi', required: false, choices: [{ id: 'extra-dip', label: 'Extra dip', price: 0.50 }] }] },
  ] },
];

test('unify + derive round-trips prices exactly', () => {
  const uni = unifyStatic(SERVER, VISUAL);
  const srv = deriveServerMenu(uni);
  const vis = deriveVisualMenu(uni);
  assert.equal(srv[0].items[0].priceP, 155);
  assert.equal(vis[0].items[0].price, 1.55);
  assert.equal(srv[0].items[1].priceP, 990);
  assert.equal(vis[0].items[1].price, 9.90);
  // Modifier link preserved and priced identically on both sides.
  assert.equal(srv[0].items[1].modifiers[0].id, 'extra-dip');
  assert.equal(srv[0].items[1].modifiers[0].priceDeltaP, 50);
  assert.equal(vis[0].items[1].options[0].choices[0].price, 0.50);
  assert.equal(vis[0].items[1].meal.forced, true);
});

test('SHOWN price always equals CHARGED price for every item + option', () => {
  const uni = unifyStatic(SERVER, VISUAL);
  const srv = deriveServerMenu(uni);
  const vis = deriveVisualMenu(uni);
  const srvItems = new Map(srv.flatMap(c => c.items).map(i => [i.id, i]));
  for (const c of vis) for (const it of c.items) {
    const s = srvItems.get(it.id);
    assert.ok(s, `${it.id} missing server side`);
    assert.equal(Math.round(it.price * 100), s.priceP, `base price parity for ${it.id}`);
    const mods = new Map((s.modifiers || []).map(m => [m.id, m.priceDeltaP]));
    for (const g of (it.options || [])) for (const ch of g.choices) {
      assert.equal(Math.round(ch.price * 100), mods.get(ch.id), `option price parity for ${ch.id}`);
    }
  }
});

test('hidden items drop out of both derived menus', () => {
  const uni = unifyStatic(SERVER, VISUAL);
  uni.categories[0].items[0].hidden = true;
  assert.equal(deriveServerMenu(uni)[0].items.length, 1);
  assert.equal(deriveVisualMenu(uni)[0].items.length, 1);
});

test('validate rejects bad prices, dup ids, empty menu', () => {
  assert.equal(validateUnified({ categories: [] }).ok, false);
  const dup = validateUnified({ categories: [{ id: 'a', name: 'A', items: [
    { id: 'x', name: 'X', priceP: 100 }, { id: 'x', name: 'Y', priceP: 200 }] }] });
  assert.equal(dup.ok, false);
  const neg = validateUnified({ categories: [{ id: 'a', name: 'A', items: [{ id: 'x', name: 'X', priceP: -5 }] }] });
  assert.equal(neg.ok, false);
});

test('validate accepts a good menu and normalises it', () => {
  const v = validateUnified(unifyStatic(SERVER, VISUAL));
  assert.equal(v.ok, true);
  assert.equal(v.doc.categories[0].items[0].priceP, 155);
});

test('validate flags a meal referencing a missing category', () => {
  const bad = { categories: [{ id: 'a', name: 'A', items: [
    { id: 'x', name: 'X', priceP: 100, meal: { label: 'm', addP: 0, choose: [{ category: 'ghost', label: 'D', count: 1 }] } }] }] };
  assert.equal(validateUnified(bad).ok, false);
});

test('slugify makes stable unique ids', () => {
  const taken = new Set(['can-of-coke']);
  assert.equal(slugify('Can of Coke!!', taken), 'can-of-coke-2');
  assert.equal(slugify('Chips & Cheese', new Set()), 'chips-cheese');
});
