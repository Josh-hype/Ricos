#!/usr/bin/env python3
"""Build Tad Kebab's two menu files from the shop's own menu.

The pair has to agree exactly — menu.json is what the server charges (pence),
menu-visual.json is what the customer sees (pounds), and build-shop.js fails
the build if a base price or a modifier delta disagrees between them. Typing
86 items twice by hand is how that drifts, so both files come out of the one
table below and the deltas are subtracted, never transcribed.

Source: https://www.tadkebab.uk/business/tad_kebab_tadcaster/menu
Nothing here is invented. Where the shop's page shows no description the item
simply has none, and the shop's own spellings are kept verbatim — "Proscuitto",
"Huna and sweetcorn", "musscls", "jalapenoes", "Donner" — because they are the
names the shop and its customers use, and silently correcting a trading menu is
not this script's call.

Run: python3 scripts/_gen-tad-menu.py
"""
import json, re, pathlib

SHOP = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'shops' / 'tad-kebab'

def p(pounds):
    """Pounds -> pence, via a string so 11.9 can never land on 1189."""
    return int(round(pounds * 100))

def slug(name):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', name.lower())).strip('-')

# --------------------------------------------------------------- shared sets
SALAD = [('sal-all', 'All Salad'), ('sal-cucumber', 'Cucumber'), ('sal-cabbage', 'Cabbage'),
         ('sal-lettuce', 'Lettuce'), ('sal-onion', 'Onion'), ('sal-none', 'No Salad')]
SAUCE_FULL = [('sau-bbq', 'BBQ Sauce'), ('sau-chilli', 'Chilli Sauce'), ('sau-peri', 'Peri peri Sauce'),
              ('sau-garlic-mayo', 'Garlic Mayo'), ('sau-sweet-chilli', 'Sweet Chilli Sauce'),
              ('sau-mayo', 'Mayonnaise'), ('sau-mint', 'Mint Sauce'), ('sau-none', 'No Sauce')]
SAUCE_CHICKEN = [('sau-chilli', 'Chilli Sauce'), ('sau-garlic', 'Garlic Sauce'), ('sau-none', 'No Sauce')]

# ------------------------------------------------------------------- the menu
# (name, description or None, price(s))
PIZZAS = [
    ('Margherita Pizza', 'Tomato and cheese base', 10.00, 11.00, 16.00),
    ('Quattro Formaggi Pizza', '4 cheeses', 11.50, 11.90, 17.40),
    ('Al Funghi Pizza', 'Mushrooms', 11.00, 11.50, 17.40),
    ('Vegetarian Pizza', 'Onions, mushrooms, peppers, sweetcorn and fresh tomatoes', 11.00, 11.50, 17.40),
    ('Pollo Pizza', 'Chicken and mushrooms', 11.00, 11.50, 17.40),
    ('Chicken And Sweetcorn Pizza', None, 11.00, 11.50, 17.40),
    ('Chicken And Pineapple Pizza', None, 11.00, 11.50, 17.40),
    ('Chicken Kiev Pizza', 'Chicken, ham and garlic', 11.00, 11.50, 17.40),
    ('Spicy Chicken Pizza', 'Chicken and jalapenoes', 11.00, 11.50, 17.40),
    ('BBQ Chicken Pizza', 'Chicken and bbq sauce', 11.00, 11.50, 17.40),
    ('Proscuitto Pizza', 'Ham', 11.00, 11.50, 17.40),
    ('Proscuitto Funghi Pizza', 'Ham and mushrooms', 11.00, 11.50, 17.40),
    ('Hawaiian Pizza', 'Ham and pineapple', 11.00, 11.50, 17.40),
    ('Napoli Pizza', 'Ham, mushrooms and pineapple', 11.50, 11.90, 17.40),
    ('Toscana Pizza', 'Ham, mushrooms onions and peppers', 11.90, 12.50, 17.90),
    ('Pepperoni Pizza', None, 11.00, 11.50, 17.40),
    ('Aldiavolo Pizza', 'Pepperoni, jalapeno, olives and onions', 11.90, 12.50, 17.90),
    ('Hot And Spicy Pizza', 'Pepperoni, chilli sauce, chicken, jalapeno and onions', 11.90, 12.50, 17.90),
    ('Spicy Beef Pizza', 'Spicy beef and jalapenoes', 11.00, 11.50, 17.40),
    ('Meat Feast Pizza', 'Salami, pepperoni, ham and spicy beef', 11.90, 12.50, 17.90),
    ('Modena Pizza', 'Salami', 9.90, 10.90, 16.50),
    ('Romana Pizza', 'Smoked salami and peppers', 11.00, 11.50, 17.40),
    ('Al Pesto Pizza', 'Pesto sauce, onions and capers', 11.50, 12.50, 17.90),
    ('Tuna Corn Pizza', 'Huna and sweetcorn', 11.90, 12.50, 17.90),
    ('Al Tonno Pizza', 'Tuna, olives, onions and capers', 11.90, 12.50, 17.90),
    ('Pescatore Pizza', 'Prawns, cockles and musscls', 12.90, 13.90, 18.90),
    ('Napoletana Pizza', 'Anchovies, capers and olives', 11.90, 12.50, 17.90),
    ('Neptune Pizza', 'Tuna, mushrooms, onions and peppers', 11.90, 12.50, 17.90),
    ('Sicilian Pizza', 'Bolognese, fresh tomatoes and peppers', 11.90, 12.50, 17.90),
    ('Bolognese Pizza', 'Bolognese, onions', 11.90, 12.50, 17.90),
    ('Mexican Pizza', 'Bolognese, onions, chilli sauce and jalapenos', 11.90, 12.50, 17.90),
    ('Tadkebab Special Pizza', 'Doner meat, onions and chilli sauce', 11.90, 12.50, 17.90),
    ('Donner Pepperoni Pizza', 'Doner meat and pepperoni', 11.90, 12.50, 17.90),
    ('Milano pizza', 'Doner Meat, ham and jalapeno', 11.90, 12.50, 17.90),
    ('Benji Pizza', 'Doner, bolognese, chicken and peppers', 11.90, 12.50, 17.90),
    ('Calcaria Pizza', 'Pepperoni, spicy beef, onion and jalapeno', 11.90, 12.50, 17.90),
    ('Fenton Pizza', 'Salami, pepperoni, onion and jalapeno', 11.90, 12.50, 17.90),
    ('Boston Pizza', 'Al pesto sauce, onion, olives and pepperoni', 11.90, 12.50, 17.90),
    ('Alfie Pizza', 'Doner, spicy beef, mushrooms and jalapeno', 11.90, 12.50, 17.90),
]

CALZONES = [
    ('Calzoni Kiev', 'Ham, Chicken, Garlic and Mushrooms', 11.40),
    ('Calzoni bolognese', 'Bolognese, Onions and Mushrooms', 11.40),
    ('Calzoni Doner', 'Doner Meat, Onions and Mushrooms', 11.40),
    ('Calzoni Meat Feast', 'Salami, Ham, Spicy Beef, Pepperoni and Chicken', 11.40),
    ('Calzoni Vegetarian', 'Mushroom, Onions, Sweetcorn and Peppers. Vegetarian', 11.40),
]

GARLIC_BREAD = [
    ('Garlic Bread', 'Vegetarian', 6.90),
    ('Garlic Bread And Sauce', 'Vegetarian', 7.40),
    ('Spicy Garlic Bread', 'Vegetarian', 7.40),
    ('Garlic Bread And Cheese', 'Vegetarian', 8.90),
    ('Garlic Bread Mushrooms And Cheese', 'Vegetarian', 9.90),
    ('Garlic Bread Doner And Cheese', None, 11.00),
    ('Garlic Bread Bolognese Sauce And Cheese', None, 11.00),
]

BURGERS = [  # (name, quarter pounder, half pounder)
    ('Plain Burger', 7.40, 8.40), ('Cheese Burger', 7.40, 8.40),
    ('Bolognese Burger', 8.40, 9.90), ('Hawaiian Burger', 7.50, 8.90),
    ('American Burger', 7.40, 8.40), ('Garlic Mushrooms Burger', 7.50, 8.90),
    ('Barbecue Burger', 7.40, 8.40), ('Chicken Burger', 7.40, 8.40),
    ('Vegetable Burger', 8.40, 9.90), ('Mexican Burger', 7.90, 9.90),
    ('Doner Burger', 7.90, 9.90), ('Chef Special Burger', 8.50, 9.90),
]

SIDES = [  # (name, description, price, extras?)
    ('Fries', 'Vegetarian', 3.50, False),
    ('Fries With Cheese', 'Vegetarian', 5.50, False),
    ('Onion Rings 10 Pieces', 'Vegetarian', 4.50, False),
    ('Hash Brown 5 Pieces', 'Vegetarian', 6.00, False),
    ('Chicken Nuggets And Chips 10 Pieces', None, 8.00, True),
    ('Chicken Strips And Chips 5 Pieces', None, 9.90, True),
    ('Garlic Mushrooms', 'Vegetarian', 6.00, False),
    ('Garlic Mushrooms In Cream With Cheese', 'Vegetarian', 6.50, False),
    ('Mixed Salad', 'Vegetarian', 5.00, False),
    ('Salad IN Pitta', 'Vegetarian', 5.00, False),
    ('Pitta Bread', 'Vegetarian', 1.00, False),
    ('Chilli Sauce', 'Vegetarian', 1.00, False),
    ('Garlic Yoghurt', 'Vegetarian', 1.00, False),
    ('Natural Yoghurt', 'Vegetarian', 1.00, False),
]

DRINKS = [('Coca-Cola 0.33L', 1.70), ('Diet Coca-Cola 0.33L', 1.70)]

# ------------------------------------------------------------------- builders
menu, visual = [], []

def group(gid, label, choices, select='single', required=True):
    """A choice group, returned as (visual option, menu modifiers)."""
    opt = {'id': gid, 'label': label, 'select': select, 'required': required,
           'choices': [{'id': cid, 'label': lab, 'price': round(delta / 100, 2)} for cid, lab, delta in choices]}
    mods = [{'id': cid, 'label': lab, 'priceDeltaP': delta} for cid, lab, delta in choices]
    return opt, mods

def add(cat_m, cat_v, item_id, name, price, desc=None, groups=(), **extra):
    mi = {'id': item_id, 'name': name, 'priceP': p(price)}
    vi = {'id': item_id, 'name': name, 'price': price}
    if desc:
        vi['desc'] = desc
    mods, opts = [], []
    for opt, m in groups:
        opts.append(opt)
        mods.extend(m)
    if mods:
        mi['modifiers'] = mods
        vi['options'] = opts
    vi.update(extra)
    cat_m['items'].append(mi)
    cat_v['items'].append(vi)

def category(cid, name, icon, note=None):
    m = {'id': cid, 'name': name, 'items': []}
    v = {'id': cid, 'name': name, 'icon': icon, 'items': []}
    if note:
        v['note'] = note
    menu.append(m)
    visual.append(v)
    return m, v

# --- pizzas: one size group per pizza, deltas SUBTRACTED from the shop's own
#     three prices rather than typed, so a 16" can never quietly disagree.
pm, pv = category('pizzas', 'Stone Baked Pizzas', '🍕', 'All pizzas come on a tomato and cheese base.')
for name, desc, thin, deep, giant in PIZZAS:
    sizes = [('sz-12-thin', '12" Thin Base', 0),
             ('sz-12-deep', '12" Deep Pan', p(deep) - p(thin)),
             ('sz-16-giant', '16" Giant', p(giant) - p(thin))]
    # spicyTag, NOT spicy: `spicy` puts a heat-level picker in the modal, and
    # this shop offers no heat levels -- these are simply spicy recipes. The
    # flag follows the shop's own word in the item NAME, nothing inferred.
    extra = {'spicyTag': True} if re.search(r'\b(spicy|hot)\b', name, re.I) else {}
    add(pm, pv, 'pizza-' + slug(name), name, thin, desc, [group('size', 'Size', sizes)], **extra)

cm, cv = category('calzones', 'Calzones', '🥟')
for name, desc, price in CALZONES:
    add(cm, cv, 'calzone-' + slug(name), name, price, desc)

gm, gv = category('garlic-bread', 'Garlic Bread', '🧄')
for name, desc, price in GARLIC_BREAD:
    add(gm, gv, 'gb-' + slug(name), name, price, desc,
        **({'spicyTag': True} if 'Spicy' in name else {}))

# --- kebabs. Salad and sauce are free choices, so they still need £0 modifiers
#     in menu.json or the kitchen ticket loses the label.
km, kv = category('kebabs', 'Kebabs', '🥙', 'Served in pitta with salad and sauce.')
salad = lambda: group('salad', 'Salad', [(i, l, 0) for i, l in SALAD], select='multi', required=False)
sauce = lambda s: group('sauce', 'Sauce', [(i, l, 0) for i, l in s], select='multi', required=False)

add(km, kv, 'kebab-chicken-kebab', 'Chicken Kebab', 13.00, 'Cubes of Chicken cooked on a Griddle',
    [salad(), sauce(SAUCE_CHICKEN)])
add(km, kv, 'kebab-donner-kebab', 'Donner Kebab', 9.90, None,
    [group('size', 'Size', [('sz-large', 'Large', 0), ('sz-king', 'King Size', p(16.90) - p(9.90))]),
     salad(), sauce(SAUCE_FULL)])
add(km, kv, 'kebab-mixed-kebab-large', 'Mixed Kebab Large', 24.90,
    'Doner, Lamb, Chicken served with 2 chilli sauce & 2 garlic sauce (portion size for 2 people)',
    [salad(), sauce(SAUCE_FULL)])
add(km, kv, 'kebab-chicken-combo', 'Chicken Combo', 17.90,
    'Doner, Lamb, Chicken served with 2 chilli sauce & 2 garlic sauce (portion size for 2 people)',
    [salad(), sauce(SAUCE_FULL)])
add(km, kv, 'kebab-king-size-donner', 'King Size Donner', 16.90, None, [salad(), sauce(SAUCE_FULL)])
add(km, kv, 'kebab-doner-and-chips-large', 'Doner And Chips Large', 11.40, None,
    [salad(), sauce(SAUCE_FULL)])

bm, bv = category('burgers', 'Burgers', '🍔', 'Served in a bun with fries and salad.')
for name, quarter, half in BURGERS:
    sizes = [('sz-quarter', 'Quarter Pounder', 0), ('sz-half', 'Half Pounder', p(half) - p(quarter))]
    add(bm, bv, 'burger-' + slug(name), name, quarter, None, [group('size', 'Size', sizes)])

am, av = category('pasta', 'Pasta', '🍝')
add(am, av, 'pasta-lasagne', 'Lasagne', 10.00)

sm, sv = category('sides', 'Side Orders', '🍟')
for name, desc, price, has_extra in SIDES:
    groups = []
    if has_extra:
        groups.append(group('extras', 'Extras', [('xt-cheese-chips', 'Cheese On Chips', 200)],
                            select='multi', required=False))
    add(sm, sv, 'side-' + slug(name), name, price, desc, groups)

dm, dv = category('drinks', 'Soft Drinks', '🥤')
for name, price in DRINKS:
    add(dm, dv, 'drink-' + slug(name), name, price, None, (), drink=True)

# --------------------------------------------------------------------- output
(SHOP / 'menu.json').write_text(json.dumps(menu, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
(SHOP / 'menu-visual.json').write_text(json.dumps(visual, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'{sum(len(c["items"]) for c in menu)} items across {len(menu)} categories')
