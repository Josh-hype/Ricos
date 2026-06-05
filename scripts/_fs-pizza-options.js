/* Configure Food Station pizza options in both menu-visual.json (£, display) and
   menu.json (pence, server truth), linked by id. Idempotent.
   - "Choose crust" (single, required): Thin Base (free), Deep Pan (free), Stuffed (£2.50)
   - "Extra toppings" (multi, unlimited): 27 toppings at £1/£2
   Free crusts are kept as £0 modifiers so the kitchen still sees the chosen crust
   (totals.js only records a modifier's label when its id exists in menu.json). */
import fs from 'fs';
const DIR = 'data/shops/food-station';

// ---- Crust (single, required) ------------------------------------------------
const CRUST = [
  ['thin-base', 'Thin Base', 0],
  ['deep-pan', 'Deep Pan', 0],
  ['stuffed', 'Stuffed crust', 250],
];
const crustChoices = CRUST.map(([id, label, p]) => ({ id, label, price: p / 100 }));
const crustMods = CRUST.map(([id, label, p]) => ({ id, label, priceDeltaP: p }));
const crustIds = new Set(CRUST.map(([id]) => id));
const crustOption = () => ({ id: 'crust', label: 'Choose crust', select: 'single', required: true, choices: crustChoices.map(c => ({ ...c })) });

// ---- Extra toppings (multi, unlimited) ---------------------------------------
const TOPPINGS = [
  ['Mozzarella cheese', 200], ['Cheddar', 200], ['Feta cheese', 200], ['Halloumi cheese', 200],
  ['Red onions', 100], ['Peppers', 100], ['Garlic butter', 100], ['Mushrooms', 100], ['Tomatoes', 100],
  ['Sweetcorn', 100], ['Black Olives', 100], ['Jalapenos', 100], ['Fresh Chillies', 100], ['Pineapple', 100],
  ['Tuna', 200], ['Prawns', 200], ['Anchovies', 200], ['Hotdog', 200], ['Ham', 200], ['Chicken', 200],
  ['Tandoori Chicken', 200], ['Pepperoni', 200], ['Donner meat', 200], ['Salami', 200], ['Spicy Beef', 200],
  ['Bacon', 200], ['Meatballs', 200],
];
const xtSlug = s => 'xt-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toppingChoices = TOPPINGS.map(([label, p]) => ({ id: xtSlug(label), label, price: p / 100 }));
const toppingMods = TOPPINGS.map(([label, p]) => ({ id: xtSlug(label), label, priceDeltaP: p }));
const toppingsOption = () => ({ id: 'extra-toppings', label: 'Extra toppings', select: 'multi', required: false, choices: toppingChoices.map(c => ({ ...c })) });

const isXt = id => String(id).startsWith('xt-');
const pizzaCat = list => { const c = list.find(x => x.id === 'pizza'); if (!c) throw new Error('no pizza category'); return c; };

const visual = JSON.parse(fs.readFileSync(`${DIR}/menu-visual.json`, 'utf8'));
const server = JSON.parse(fs.readFileSync(`${DIR}/menu.json`, 'utf8'));
const vItems = pizzaCat(visual).items;
const sItems = pizzaCat(server).items;

for (const item of vItems) {
  // keep size; drop the old "addons"/crust/toppings; re-add crust then toppings.
  item.options = (item.options || []).filter(o => !['addons', 'crust', 'extra-toppings'].includes(o.id));
  item.options.push(crustOption());
  item.options.push(toppingsOption());
}
for (const item of sItems) {
  item.modifiers = (item.modifiers || []).filter(m => !isXt(m.id) && !crustIds.has(m.id));
  for (const m of crustMods) item.modifiers.push({ ...m });
  for (const m of toppingMods) item.modifiers.push({ ...m });
}

fs.writeFileSync(`${DIR}/menu-visual.json`, JSON.stringify(visual, null, 2) + '\n');
fs.writeFileSync(`${DIR}/menu.json`, JSON.stringify(server, null, 2) + '\n');
console.log('pizzas:', vItems.length, '| crust choices:', crustChoices.length, '| toppings:', TOPPINGS.length);
console.log('item ids match:', vItems.map(i => i.id).sort().join('|') === sItems.map(i => i.id).sort().join('|'));
