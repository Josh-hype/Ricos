/* Canonical menu — used both for server-side price calc and for the frontend
   (via /api/menu).

   This file is intentionally compact: prices in pence, no images, no design.
   Images and descriptions stay in the public menu rendered on the order page;
   the source of truth for those will be moved into data/menu.json once the
   inline data is extracted from order.html.

   Structure:
     [{ id, name, items: [{ id, name, priceP, mealAddP?, modifiers?: [...] }] }]
*/

const MENU = [
  {
    id: 'signature',
    name: 'Signature Chicken',
    items: [
      { id: 'sig-thighs',     name: 'Signature Peri Thighs ×3', priceP: 1095, mealAddP: 400 },
      { id: 'sig-quarter',    name: 'Quarter Peri Chicken',     priceP: 795,  mealAddP: 400 },
      { id: 'sig-half',       name: 'Half Peri Chicken',        priceP: 1295, mealAddP: 400 },
      { id: 'sig-whole',      name: 'Whole Peri Chicken',       priceP: 1995, mealAddP: 600 },
      { id: 'sig-strips',     name: 'Peri Strips ×5',           priceP: 895,  mealAddP: 400 },
      { id: 'sig-wings',      name: 'Peri Wings ×6',            priceP: 695,  mealAddP: 400 },
    ],
  },
  {
    id: 'burgers',
    name: 'Burgers & Wraps',
    items: [
      { id: 'b-classic',  name: 'Classic Peri Burger',  priceP: 895,  mealAddP: 400 },
      { id: 'b-double',   name: 'Double Peri Burger',   priceP: 1195, mealAddP: 400 },
      { id: 'b-wrap',     name: 'Peri Chicken Wrap',    priceP: 795,  mealAddP: 400 },
      { id: 'b-mango',    name: 'Mango & Lime Burger',  priceP: 995,  mealAddP: 400 },
    ],
  },
  {
    id: 'sides',
    name: 'Sides',
    items: [
      { id: 's-chips',     name: 'Peri Chips',         priceP: 395 },
      { id: 's-rice',      name: 'Spicy Rice',         priceP: 395 },
      { id: 's-corn',      name: 'Corn on the Cob',    priceP: 295 },
      { id: 's-coleslaw',  name: 'Coleslaw',           priceP: 295 },
      { id: 's-mac',       name: 'Mac & Cheese',       priceP: 395 },
      { id: 's-salad',     name: 'House Salad',        priceP: 395 },
    ],
  },
  {
    id: 'drinks',
    name: 'Drinks',
    items: [
      { id: 'd-coke',      name: 'Coca-Cola',           priceP: 195 },
      { id: 'd-cokediet',  name: 'Diet Coke',           priceP: 195 },
      { id: 'd-cokezero',  name: 'Coke Zero',           priceP: 195 },
      { id: 'd-fanta',     name: 'Fanta Orange',        priceP: 195 },
      { id: 'd-sprite',    name: 'Sprite',              priceP: 195 },
      { id: 'd-water',     name: 'Still Water 500ml',   priceP: 150 },
    ],
  },
  {
    id: 'kids',
    name: 'Kids',
    items: [
      { id: 'k-meal',  name: 'Kids Peri Meal',  priceP: 595 },
    ],
  },
];

export function getMenu() {
  return MENU;
}
