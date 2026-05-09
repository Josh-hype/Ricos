/* Canonical menu — used both for server-side price calc and for the frontend
   (via /api/menu). Source of truth for prices.

   Prices in pence. mealAddP applies when the line opts into the meal upgrade
   on the order page.

   When you change a price, redeploy. Visual menu (photos, descriptions,
   category artwork) lives in public/order.html and pulls names/prices via
   the same ids; keep them in sync. */

const MENU = [
  {
    id: 'signature',
    name: 'Signature Chicken',
    items: [
      { id: 'sig-thighs', name: 'Signature Peri Thighs ×3', priceP: 1095, mealAddP: 400 },
      { id: 'quarter',    name: 'Quarter Chicken',           priceP:  695, mealAddP: 300 },
      { id: 'half',       name: 'Half Chicken',              priceP:  995, mealAddP: 300 },
      { id: 'full',       name: 'Full Chicken',              priceP: 1495, mealAddP: 300 },
      { id: 'dippers',    name: 'Chicken Dippers',           priceP:  745, mealAddP: 300 },
      { id: 'rice-box',   name: 'Rice Box',                  priceP:  895, mealAddP: 300 },
    ],
  },
  {
    id: 'wings',
    name: 'Blazing Wings',
    items: [
      { id: 'wings-6', name: '6× Wings', priceP: 695, mealAddP: 300 },
    ],
  },
  {
    id: 'wraps',
    name: 'Wraps & Burrito',
    items: [
      { id: 'queen-wrap',   name: 'Queen Wrap',          priceP: 795, mealAddP: 300 },
      { id: 'dipper-wrap',  name: 'Chicken Dipper Wrap', priceP: 745, mealAddP: 300 },
      { id: 'king-burrito', name: 'King Burrito',        priceP: 845, mealAddP: 300 },
    ],
  },
  {
    id: 'burgers',
    name: 'Burgers',
    items: [
      { id: 'chicken-deluxe', name: 'Chicken Deluxe Burger',     priceP: 800, mealAddP: 300 },
      { id: 'beef-classic',   name: 'Classic Beef Burger',       priceP: 990, mealAddP: 300 },
      { id: 'beef-chipotle',  name: 'Chipotle BBQ Beef Burger',  priceP: 990, mealAddP: 300 },
      { id: 'beef-nacho',     name: 'Nacho Cheese Beef Burger',  priceP: 990, mealAddP: 300 },
      { id: 'beef-sweet',     name: 'Sweet Chilli Beef Burger',  priceP: 990, mealAddP: 300 },
      { id: 'beef-hot',       name: 'Hot & Spicy Beef Burger',   priceP: 990, mealAddP: 300 },
    ],
  },
  {
    id: 'platters',
    name: 'Platters',
    items: [
      { id: 'wings-platter',  name: 'Wings Platter',           priceP: 1645 },
      { id: 'mega-wings',     name: 'Mega Wings Platter',      priceP: 2445 },
      { id: 'kings-platter',  name: 'Kings Platter',           priceP: 1295 },
      { id: 'family-platter', name: 'Family Evening Platter',  priceP: 2895 },
      { id: 'big-boss',       name: 'The Big Boss Platter',    priceP: 4495 },
    ],
  },
  {
    id: 'sides',
    name: 'Sides',
    items: [
      { id: 'side-thighs',  name: '2× Thighs',             priceP: 695 },
      { id: 'side-wings',   name: '3× Wings',              priceP: 395 },
      { id: 'popcorn',      name: 'Popcorn Chicken',       priceP: 695 },
      { id: 'mozz',         name: '3× Mozzarella Sticks',  priceP: 295 },
      { id: 'rings',        name: '6× Onion Rings',        priceP: 295 },
      { id: 'jalapeno',     name: '4× Jalapeño Poppers',   priceP: 395 },
      { id: 'chips-reg',    name: 'Chips (Regular)',       priceP: 290 },
      { id: 'chips-lrg',    name: 'Chips (Large)',         priceP: 350 },
      { id: 'curly',        name: 'Curly Fries',           priceP: 390 },
      { id: 'wedges',       name: 'Potato Wedges',         priceP: 395 },
      { id: 'chips-cheese', name: 'Chips & Cheese',        priceP: 495 },
      { id: 'chips-nacho',  name: 'Chips & Nacho Cheese',  priceP: 495 },
      { id: 'rice',         name: 'Spicy Rice',            priceP: 300 },
      { id: 'slaw',         name: 'Coleslaw',              priceP: 260 },
      { id: 'dip-mayo',     name: 'Dip — Mayo',            priceP:  50 },
      { id: 'dip-sweet',    name: 'Dip — Sweet Chilli',    priceP:  50 },
      { id: 'dip-hot',      name: 'Dip — Hot Chilli',      priceP:  50 },
      { id: 'dip-ketchup',  name: 'Dip — Ketchup',         priceP:  50 },
      { id: 'dip-chipotle', name: 'Dip — Chipotle',        priceP:  50 },
      { id: 'dip-garlic',   name: 'Dip — Garlic Mayo',     priceP:  50 },
    ],
  },
  {
    id: 'kids',
    name: 'Kids Menu',
    items: [
      { id: 'kids-nuggets', name: 'Kids Nuggets', priceP: 595 },
      { id: 'kids-burger',  name: 'Kids Burger',  priceP: 595 },
      { id: 'kids-wings',   name: 'Kids Wings',   priceP: 595 },
    ],
  },
  {
    id: 'drinks',
    name: 'Soft Drinks',
    items: [
      { id: 'can-coke',        name: 'Can of Coke',          priceP: 190 },
      { id: 'can-coke-zero',   name: 'Can of Coke Zero',     priceP: 190 },
      { id: 'can-diet',        name: 'Can of Diet Coke',     priceP: 190 },
      { id: 'can-drpepper',    name: 'Can of Dr Pepper',     priceP: 190 },
      { id: 'can-pepsi',       name: 'Can of Pepsi',         priceP: 190 },
      { id: 'can-fanta',       name: 'Can of Fanta Orange',  priceP: 190 },
      { id: 'can-fanta-lemon', name: 'Can of Fanta Lemon',   priceP: 190 },
      { id: 'can-sprite',      name: 'Can of Sprite',        priceP: 190 },
      { id: 'can-7up',         name: 'Can of 7Up',           priceP: 190 },
      { id: 'btl-water',       name: 'Bottle of Water',      priceP: 150 },
      { id: 'btl-pepsi',       name: 'Bottle of Pepsi',      priceP: 380 },
    ],
  },
  {
    id: 'shakes',
    name: 'Milkshakes',
    items: [
      { id: 'shake-billion', name: 'Billionaires',   priceP: 595 },
      { id: 'shake-cookie',  name: 'Cookie Monster', priceP: 595 },
      { id: 'shake-banana',  name: 'Banana Royale',  priceP: 595 },
    ],
  },
  {
    id: 'sweet',
    name: 'Sweet Treats',
    items: [
      { id: 'fudge-cake', name: 'Chocolate Fudge Cake',   priceP: 495 },
      { id: 'cheesecake', name: 'Strawberry Cheesecake',  priceP: 495 },
      { id: 'bj-fudge',   name: "Ben & Jerry's Chocolate Fudge Brownie", priceP: 725 },
      { id: 'bj-cookie',  name: "Ben & Jerry's Cookie Dough",            priceP: 725 },
      { id: 'bj-phish',   name: "Ben & Jerry's Phish Food",              priceP: 725 },
    ],
  },
];

export function getMenu() {
  return MENU;
}
