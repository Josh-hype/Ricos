/* No shop may auto-select a choice that COSTS MONEY.
   Run: node --import ./tests/support/register.mjs --test tests/

   A pre-selected choice skips the group's "Choose…" placeholder, so nobody —
   staff or customer — has to look at it to get past it. If that choice carries a
   price, it is money nobody consciously agreed to, and it is invisible in
   exactly the way that means it goes unnoticed for weeks.

   It has happened, on a trading shop: Dominic's "Donner Meat And Chips" had an
   OPTIONAL single-select group holding one paid choice, ADD CHEESE (+£1.50). The
   till's lone-choice shortcut pre-selected it and, with no empty row, left no
   way to remove it — £11.40 rung up for a £9.90 item, on three kebabs.

   This walks every shop's real menu and applies the till's own pre-selection
   rules, so the invariant is checked against the data that actually ships. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const SHOPS = new URL('../data/shops/', import.meta.url);

function shopMenus() {
  const out = [];
  for (const slug of readdirSync(SHOPS)) {
    if (slug.startsWith('_')) continue;
    const f = new URL(`${slug}/menu-visual.json`, SHOPS);
    if (!existsSync(f)) continue;
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    out.push([slug, doc.categories || doc]);
  }
  return out;
}

/* The till's rule, transliterated from optionGroupHTML in templates/staff/:
   a lone choice in a REQUIRED group, else posDefault, else default. Returns the
   choice that opens selected, or null for "Choose…" / "None". */
function autoSelected(group) {
  const choices = group.choices || [];
  if (group.select === 'multi') return null;          // checkboxes; untickable
  if (group.required && choices.length === 1) return choices[0];
  return choices.find((c) => c.posDefault === true)
      || choices.find((c) => c.default === true)
      || null;
}

test('every shop has at least one menu to check', () => {
  const menus = shopMenus();
  assert.ok(menus.length >= 5, `only found ${menus.length} shop menus — is the path right?`);
});

test('no auto-selected choice costs money, in any shop', () => {
  const offenders = [];
  for (const [slug, cats] of shopMenus()) {
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        for (const group of (item.options || [])) {
          const chosen = autoSelected(group);
          if (chosen && Number(chosen.price)) {
            offenders.push(
              `${slug} · ${cat.name} · ${item.name} · ${group.label} → `
              + `"${chosen.label}" opens selected at +£${Number(chosen.price).toFixed(2)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    'these choices are pre-selected AND cost money:\n  ' + offenders.join('\n  '));
});

test('an optional single-select is never pre-selected by the lone-choice rule', () => {
  // The specific shape that caused it. Optional means the customer may decline,
  // so the group must open on "None" whatever it contains — a lone choice in an
  // OPTIONAL group must not be auto-selected even when it is free, or there is
  // still nothing to decline with.
  const offenders = [];
  for (const [slug, cats] of shopMenus()) {
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        for (const group of (item.options || [])) {
          if (group.select === 'multi' || group.required) continue;
          if ((group.choices || []).length === 1 && autoSelected(group)) {
            offenders.push(`${slug} · ${item.name} · ${group.label}`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join(', '));
});

test('the rule still pre-selects a REQUIRED lone choice', () => {
  // The other half: a required group with one answer should not make anyone tap
  // it. Dominic's meal deals have exactly this (Drink → Pepsi Bottle), so guard
  // that the fix did not take it away.
  const g = { select: 'single', required: true, choices: [{ id: 'pepsi', label: 'Pepsi Bottle', price: 0 }] };
  assert.equal(autoSelected(g)?.id, 'pepsi');
  // ...and that the same group, marked optional, is NOT pre-selected.
  assert.equal(autoSelected({ ...g, required: false }), null);
});
