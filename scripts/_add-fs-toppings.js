/* One-off: add an "Extra toppings" multi-select (no limit) to every pizza in
   Food Station, in both menu-visual.json (£) and menu.json (pence), linked by id.
   Idempotent — re-running replaces the xt-* topping set. */
import fs from 'fs';
const DIR = 'data/shops/food-station';

// [label, priceP]
const TOPPINGS = [
  ['Mozzarella cheese', 200], ['Cheddar', 200], ['Feta cheese', 200], ['Halloumi cheese', 200],
  ['Red onions', 100], ['Peppers', 100], ['Garlic butter', 100], ['Mushrooms', 100], ['Tomatoes', 100],
  ['Sweetcorn', 100], ['Black Olives', 100], ['Jalapenos', 100], ['Fresh Chillies', 100], ['Pineapple', 100],
  ['Tuna', 200], ['Prawns', 200], ['Anchovies', 200], ['Hotdog', 200], ['Ham', 200], ['Chicken', 200],
  ['Tandoori Chicken', 200], ['Pepperoni', 200], ['Donner meat', 200], ['Salami', 200], ['Spicy Beef', 200],
  ['Bacon', 200], ['Meatballs', 200],
];
const slug = s => 'xt-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const choices = TOPPINGS.map(([label, p]) => ({ id: slug(label), label, price: p / 100 }));
const mods = TOPPINGS.map(([label, p]) => ({ id: slug(label), label, priceDeltaP: p }));

function pizzaCat(list) {
  const c = list.find(x => x.id === 'pizza');
  if (!c) throw new Error('no pizza category');
  return c;
}

const visual = JSON.parse(fs.readFileSync(`${DIR}/menu-visual.json`, 'utf8'));
const server = JSON.parse(fs.readFileSync(`${DIR}/menu.json`, 'utf8'));

const vItems = pizzaCat(visual).items;
const sItems = pizzaCat(server).items;

for (const item of vItems) {
  item.options = (item.options || []).filter(o => o.id !== 'extra-toppings');
  item.options.push({ id: 'extra-toppings', label: 'Extra toppings', select: 'multi', required: false, choices: choices.map(c => ({ ...c })) });
}
for (const item of sItems) {
  item.modifiers = (item.modifiers || []).filter(m => !String(m.id).startsWith('xt-'));
  for (const m of mods) item.modifiers.push({ ...m });
}

fs.writeFileSync(`${DIR}/menu-visual.json`, JSON.stringify(visual, null, 2) + '\n');
fs.writeFileSync(`${DIR}/menu.json`, JSON.stringify(server, null, 2) + '\n');

console.log('toppings:', TOPPINGS.length);
console.log('visual pizzas (' + vItems.length + '):', vItems.map(i => i.id).join(', '));
console.log('server pizzas (' + sItems.length + '):', sItems.map(i => i.id).join(', '));
const vset = vItems.map(i => i.id).sort().join('|');
const sset = sItems.map(i => i.id).sort().join('|');
console.log('item ids match between files:', vset === sset);
