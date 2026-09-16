#!/usr/bin/env python3
"""Generate Leaf's menu.json + menu-visual.json from ONE table.

Run:  python3 scripts/_gen-leaf-menu.py

Why a generator and not two hand-edited files: the two files carry the same
prices in different units — menu.json in pence (the server charges from it),
menu-visual.json in pounds (the customer reads it). Typing 92 items twice is
how a 9.50 becomes a 950 in one file and a 95 in the other, and the customer is
quoted one price and charged another. Here every price is written once, in
pounds exactly as the printed menu shows it, and the pence value is derived.

Source: the shop's printed two-page menu (THE LEAF CAFE - BISTRO, "Where Every
Cup Feels Like Home"). Names and spellings are kept as printed.

Category order is NOT the printed order. The printed sheet is laid out for two
physical pages in columns; this is the order someone ordering online wants —
meals first, then sides, kids, desserts, and drinks last.
"""
import json
import os

# Category: (id, display name, icon, [items])
# Item:     (id, name, price in POUNDS, description or '')
MENU = [
 ('breakfast', 'Breakfast', '🍳', [
   ('bf-mini',   'Mini English Breakfast',  11.50,
    '2 Bacon, 2 Sausages, 2 Hash Browns, 2 Eggs, 2 Grilled Tomatoes, Mushrooms, Baked Beans, 2 Slices of Toast. Served with a hot drink.'),
   ('bf-full',   'Full English Breakfast',  13.50,
    '3 Bacon, 3 Sausages, 2 Hash Browns, 2 Eggs, 2 Grilled Tomatoes, Mushrooms, Baked Beans, 2 Slices of Toast. Served with a hot drink.'),
   ('bf-veggie', 'Veggie Breakfast',        10.50,
    'Spinach Omelette, 2 Hash Browns, Baked Beans, Grilled Tomato, Mushrooms. Served with a hot drink.'),
 ]),

 ('hot-sandwiches', 'Hot Sandwiches', '🥪', [
   ('hs-bacon',      'Bacon Sandwich',                 6.00, ''),
   ('hs-sausage',    'Sausage Sandwich',               6.00, ''),
   ('hs-bacon-saus', 'Bacon & Sausage Sandwich',       7.00, ''),
   ('hs-blt',        'BLT Sandwich',                   7.00, ''),
   ('hs-bacon-egg',  'Bacon & Egg Sandwich',           7.00, ''),
   ('hs-bse',        'Bacon, Sausage & Egg Sandwich',  8.00, ''),
   ('hs-special',    'Leaf Special Sandwich',          9.50, 'Bacon, Sausage, Ham, Spam'),
   ('hs-spam',       'Spam Sandwich',                  7.00, ''),
 ]),

 ('cold-sandwiches', 'Cold Sandwiches', '🥬', [
   ('cs-tuna',    'Tuna Mayo',     6.00, ''),
   ('cs-chicken', 'Chicken Mayo',  6.00, ''),
   ('cs-ham',     'Ham & Cheese',  6.00, ''),
 ]),

 ('toasties', 'Toasties', '🧀', [
   ('to-cheese',      'Cheese Toastie',             4.50, ''),
   ('to-ham-cheese',  'Ham & Cheese Toastie',       5.50, ''),
   ('to-cheese-onion','Cheese & Onion Toastie',     5.50, ''),
   ('to-bacon',       'Bacon Toastie',              5.50, ''),
   ('to-sausage',     'Sausage Toastie',            5.50, ''),
   ('to-bacon-saus',  'Bacon & Sausage Toastie',    5.50, ''),
   ('to-beans',       'Beans on Toast',             5.00, ''),
   ('to-buttered',    'Buttered Toast',             1.00, ''),
 ]),

 ('paninis', 'Paninis', '🥖', [
   ('pa-ham-cheese',  'Ham & Cheese',               8.00, 'Served with chips & homemade tzatziki dip.'),
   ('pa-tuna-cheese', 'Tuna Mayo & Cheese',         8.50, 'Served with chips & homemade tzatziki dip.'),
   ('pa-ham-pep',     'Ham & Pepperoni',            8.50, 'Served with chips & homemade tzatziki dip.'),
   ('pa-halloumi',    'Halloumi & Tomato',          8.50, 'Served with chips & homemade tzatziki dip.'),
   ('pa-tmp',         'Tomato, Mozzarella & Pesto', 8.50, 'Served with chips & homemade tzatziki dip.'),
   ('pa-chicken',     'Chicken Mayo',               8.50, 'Served with chips & homemade tzatziki dip.'),
   ('pa-cheese-onion','Cheese & Onion',             8.00, 'Served with chips & homemade tzatziki dip.'),
 ]),

 ('wraps', 'Wraps', '🌯', [
   ('wr-chicken',     'Grilled Chicken',  8.50, 'Served with chips & homemade tzatziki dip.'),
   ('wr-lamb',        'Grilled Lamb',     9.50, 'Served with chips & homemade tzatziki dip.'),
   ('wr-mixed',       'Grilled Mixed',   10.00, 'Served with chips & homemade tzatziki dip.'),
   ('wr-chick-strip', 'Chicken Strip',    8.50, 'Served with chips & homemade tzatziki dip.'),
   ('wr-bacon-saus',  'Bacon & Sausage',  8.50, 'Served with chips & homemade tzatziki dip.'),
   ('wr-chips-cheese','Chips & Cheese',   7.00, 'Served with chips & homemade tzatziki dip.'),
 ]),

 ('melts', 'Melts', '🫓', [
   ('me-chicken',  'Grilled Chicken', 8.50, 'Served with chips, salad & homemade tzatziki.'),
   ('me-lamb',     'Grilled Lamb',    9.50, 'Served with chips, salad & homemade tzatziki.'),
   ('me-halloumi', 'Halloumi',        8.50, 'Served with chips, salad & homemade tzatziki.'),
   ('me-mix',      'Grilled Mix',    10.00, 'Lamb & Chicken. Served with chips, salad & homemade tzatziki.'),
 ]),

 ('burgers', 'Burgers', '🍔', [
   ('bu-beef',    '1/4 lb Beef Burger',    5.50, 'Served with chips.'),
   ('bu-chicken', '1/4 lb Chicken Burger', 5.50, 'Served with chips.'),
   ('bu-special', 'Leaf Special Burger',   8.50,
    'Double Beef, Double Bacon, Pepperoni (Lettuce, Tomato, Red Onion & Sauce on request). Served with chips.'),
 ]),

 ('omelettes', 'Omelettes', '🥚', [
   ('om-mushroom', 'Mushroom',      9.00, ''),
   ('om-ham',      'Ham & Cheese',  9.50, ''),
   ('om-spinach',  'Spinach',       9.00, ''),
   ('om-special',  'Leaf Special', 10.50, 'Ham, Chicken, Cheese, Red Onion'),
 ]),

 ('pizzas', 'Pizzas', '🍕', [
   ('pz-margherita', 'Margherita', 11.00, ''),
   ('pz-pepperoni',  'Pepperoni',  12.00, ''),
   ('pz-meat-feast', 'Meat Feast', 13.50, 'Salami, Pepperoni, Ham, Red Onion'),
 ]),

 ('calzones', 'Calzones', '🥟', [
   ('cz-pepperoni',  'Pepperoni',                12.00, ''),
   ('cz-chick-spin', 'Chicken, Spinach & Feta',  13.00, ''),
   ('cz-meat-feast', 'Meat Feast',               13.50, 'Salami, Pepperoni, Ham, Red Onion'),
 ]),

 ('jackets', 'Jacket Potatoes', '🥔', [
   ('jp-cheese-beans', 'Cheese or Beans', 8.00, 'Served with salad.'),
   ('jp-tuna',         'Tuna Mayo',       9.00, 'Served with salad.'),
   ('jp-chicken',      'Chicken Mayo',    9.50, 'Served with salad.'),
 ]),

 ('salads', 'Salads', '🥗', [
   ('sa-tuna',     'Tuna',     9.00, ''),
   ('sa-chicken',  'Chicken',  9.50, ''),
   ('sa-halloumi', 'Halloumi', 8.50, ''),
 ]),

 ('soup', 'Soup of the Day', '🍲', [
   ('so-red-lentil', 'Red Lentil Soup', 6.00,
    'Freshly made every day. Served with freshly baked stone-baked bread.'),
 ]),

 ('garlic-bread', 'Garlic Bread', '🧄', [
   ('gb-cheese', 'Garlic Bread with Cheese', 6.00, ''),
 ]),

 ('sides', 'Sides', '🍟', [
   ('si-chips',    'Chips',                  4.00, ''),
   ('si-hash',     'Hash Browns (6 pcs)',    6.00, ''),
   ('si-strips',   'Chicken Strips (6 pcs)', 6.00, ''),
   ('si-nuggets',  'Chicken Nuggets (10 pcs)', 6.00, ''),
   ('si-tzatziki', 'Homemade Tzatziki',      2.50, ''),
 ]),

 ('kids', "Little Leaf Kids' Meals", '🧒', [
   ('ki-nuggets', '8 Chicken Nuggets', 6.00, 'Served with chips & fruit juice.'),
   ('ki-strips',  '5 Chicken Strips',  6.00, 'Served with chips & fruit juice.'),
   ('ki-hash',    '5 Hash Browns',     6.00, 'Served with chips & fruit juice.'),
 ]),

 ('desserts', 'Desserts', '🍰', [
   ('de-fudge',      'Fudge Cake',              5.50, ''),
   ('de-cheesecake', 'Cheesecake',              5.50, ''),
   ('de-tiramisu',   'Tiramisu',                5.50, ''),
   ('de-choc-muffin','Double Chocolate Muffin', 2.00, ''),
   ('de-butter-muffin','Black Buttery Muffin',  2.00, ''),
 ]),

 ('hot-drinks', 'Hot Drinks', '☕', [
   ('hd-americano',   'Americano',      3.00, ''),
   ('hd-espresso',    'Espresso',       2.50, ''),
   ('hd-cappuccino',  'Cappuccino',     3.00, ''),
   ('hd-latte',       'Latte',          3.00, ''),
   ('hd-flat-white',  'Flat White',     3.00, ''),
   ('hd-macchiato',   'Macchiato',      3.00, ''),
   ('hd-mocha',       'Mocha',          3.00, ''),
   ('hd-hot-choc',    'Hot Chocolate',  3.00, ''),
   ('hd-caramel',     'Caramel Latte',  3.00, ''),
   ('hd-tea',         'Tea Selection',  2.50, ''),
 ]),

 ('soft-drinks', 'Soft Drinks', '🥤', [
   ('sd-water',     'Water',           1.50, ''),
   ('sd-fruit',     'Fruit Juice',     1.50, ''),
   ('sd-coke',      'Coca-Cola',       2.50, ''),
   ('sd-diet-coke', 'Diet Coke',       2.50, ''),
   ('sd-7up',       '7UP',             2.50, ''),
   ('sd-tango',     'Tango',           2.50, ''),
   ('sd-orange',    'Orange Juice',    2.50, ''),
   ('sd-apple',     'Apple Juice',     2.50, ''),
   ('sd-cranberry', 'Cranberry Juice', 2.50, ''),
 ]),
]

# The one priced choice the printed menu spells out: the burgers box carries
# "Extra Beef or Chicken +£2.00". Applied to all three burgers.
EXTRA_MEAT = ('extra-meat', 'Extra Beef or Chicken', 2.00)
WITH_EXTRA = {'bu-beef', 'bu-chicken', 'bu-special'}

P = lambda pounds: int(round(pounds * 100))   # pounds -> pence, once, here


def build():
    server, visual = [], []
    for cid, cname, icon, items in MENU:
        s_items, v_items = [], []
        for iid, name, price, desc in items:
            s = {'id': iid, 'name': name, 'priceP': P(price)}
            v = {'id': iid, 'name': name, 'price': price}
            if desc:
                v['desc'] = desc
            if iid in WITH_EXTRA:
                ex_id, ex_label, ex_price = EXTRA_MEAT
                s['modifiers'] = [{'id': ex_id, 'label': ex_label, 'priceDeltaP': P(ex_price)}]
                v['options'] = [{
                    'id': 'extras', 'label': 'Extras', 'select': 'multi', 'required': False,
                    'choices': [{'id': ex_id, 'label': ex_label, 'price': ex_price}],
                }]
            s_items.append(s)
            v_items.append(v)
        server.append({'id': cid, 'name': cname, 'items': s_items})
        visual.append({'id': cid, 'name': cname, 'icon': icon, 'items': v_items})
    return server, visual


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'data', 'shops', 'leaf-cafe')
    server, visual = build()

    for path, data in ((os.path.join(out, 'menu.json'), server),
                       (os.path.join(out, 'menu-visual.json'), visual)):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')

    n = sum(len(c['items']) for c in server)
    print(f'leaf-cafe: {n} items across {len(server)} categories')

    # Prove the two files agree before anyone deploys them.
    s_ids = [i['id'] for c in server for i in c['items']]
    v_ids = [i['id'] for c in visual for i in c['items']]
    assert s_ids == v_ids, 'item ids differ between the two files'
    assert len(s_ids) == len(set(s_ids)), 'duplicate item id'
    smap = {i['id']: i for c in server for i in c['items']}
    vmap = {i['id']: i for c in visual for i in c['items']}
    for k in s_ids:
        assert smap[k]['priceP'] == P(vmap[k]['price']), f'price mismatch on {k}'
        assert smap[k]['name'] == vmap[k]['name'], f'name mismatch on {k}'
    print('checked: ids, names and prices agree across both files')


if __name__ == '__main__':
    main()
