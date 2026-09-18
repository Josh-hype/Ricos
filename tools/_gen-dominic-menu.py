#!/usr/bin/env python3
"""Build Dominic Pizza's menu.json + menu-visual.json from the owner's extraction.

Run:  python3 tools/_gen-dominic-menu.py <workbook.xlsx>

Hand-run tooling: lives in tools/ so editing it never queues a build on the
nine Pages projects (see the tools/ row in CLAUDE.md). Re-runnable — it
overwrites both files from the workbook every time.

SOURCE: an xlsx extraction of the shop's live FoodBooking menu, captured
17 Sep 2026. Five sheets: Overview, Menu (177 items), Variants (304 rows),
"Modifier groups" (1038) and "Modifier choices" (7977).

HOW THE TWO SHAPES MAP (see CLAUDE.md "Menu / item-options schema"):

  menu.json        server truth, prices in PENCE
                   [{id, name, items:[{id, name, priceP, modifiers:[...]}]}]
  menu-visual.json customer display, prices in POUNDS
                   [{id, name, icon, items:[{id, name, price, desc, options:[...]}]}]

  Sizes are NOT a separate concept — a size is just a modifier with a price
  delta. So priceP is the CHEAPEST variant and each size becomes a modifier
  whose delta is (that variant - cheapest). An 11" pizza is the base and 13"/15"
  are surcharges.

  1194 choices are priced BY SIZE (extra toppings are £2.10 on an 11" and £3.20
  on a 15"). Those carry priceDeltaPBySize keyed by the size modifier's own id;
  totals.js finds whichever size id is selected and uses that delta, falling
  back to priceDeltaP for the base size. Verified against the workbook: group
  metadata and choice sets are identical across sizes, only surcharges move, so
  one merged group per (order, name) is lossless.

JOIN KEY: "Group ID" from the workbook, never (item, group name) — 33 items
repeat a group name at two different positions (a 2-pizza deal has "Crust" and
"Extra toppings" twice, once per pizza). Keyed on the name those collapse into
one group and the item silently loses half its options; keyed on Group ID there
are zero duplicate choices anywhere in the file.
"""
import json, re, sys, unicodedata
from collections import defaultdict, OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'data' / 'shops' / 'dominic-pizza'

# Emoji per category for the order page's category tiles. Order follows the
# workbook, which follows the shop's own live menu.
ICONS = {
    'New!! Pizza Fries!': '🍟', 'Pizza': '🍕', 'Vegan Pizzas': '🌱',
    'Garlic Bread': '🥖', 'Calzones': '🥟', 'Burgers': '🍔', 'Kebabs': '🥙',
    'Parmesans': '🧀', 'Nachos': '🌮', 'Specials': '⭐', 'Wraps': '🌯',
    'Side Orders': '🍟', 'Sauces': '🥫', 'Kids Menu': '🧒', 'Desserts': '🍰',
    'Drinks': '🥤', 'Alcoholic Drinks': '🍺', 'Special Offers': '🎉',
}

# Categories held out of the percentage promo via noPromo (set in BOTH files or
# the build fails the parity check).
#
# EMPTY BY THE OWNER'S DECISION, 17 Sep 2026. The Special Offers bundles were
# excluded on the first import, because 20% off Meal Deal 1 takes £20 to £16
# against £19.90 for the cheapest possible parts (2 x 11" Margherita + a Pepsi
# bottle), and further under on the dearer pizzas. The owner confirmed the deals
# DO get the discount on their existing FoodBooking page and asked to match it,
# so the platform now behaves the same and the offer is consistent with what
# their customers already see.
#
# Do not "fix" this back without asking: it is a priced commercial decision, not
# an oversight. Put 'Special Offers' back in this set to reverse it.
NO_PROMO_CATEGORIES = set()

# TILL-ONLY pre-selected choices: {category: {group label: choice label}}, all
# matched lowercased. Emitted as `posDefault: true`, which only the till honours
# (optionGroupHTML in templates/staff/index.html) — the order page knows nothing
# about it, so a CUSTOMER still gets "Choose…" and has to pick.
#
# OWNER'S DECISION, 18 Sep 2026: on the till, pizzas and garlic breads open on
# 11" and Thick. Staff take the same order fifty times a night and were tapping
# both on every single one. On the website the customer is still asked, because a
# size and a crust they did not choose is a complaint waiting to happen.
#
# ⚠️ ONLY EVER POINT THIS AT A £0.00 CHOICE. A default jumps the group past its
# "Choose…" placeholder, so a paid choice here becomes money nobody consciously
# agreed to — and staff would not see it any more than the customer. Every entry
# below is the base option: 11" is the price in menu.json (13" is +£1.70 and 15"
# +£4.00 on a pizza) and Thick is £0.00 against +£2.10 / +£2.70 for the stuffed
# crusts. The generator asserts this and refuses to write a priced default.
#
# Scoped BY CATEGORY on purpose: "Size" also exists on Burgers (1/4lb, 1/2lb) and
# Kebabs (Medium, Large), where an 11" rule is meaningless, and "Crust" appears on
# Special Offers, where the owner did not ask for it.
# Choices the workbook does not contain, injected into an existing group:
#   {category: {group label: [(choice label, price in POUNDS), ...]}}
#
# OWNER'S DECISION, 18 Sep 2026: a burger comes with chips, and a customer who
# does not want them pays £2.50 less. The workbook's Chips group only offers
# Chips (£0.00) and CHIPS WITH CHEESE (+£1.50), so "No chips" has to be added
# here — re-running the generator keeps it, which a hand-edit of the JSON would
# not.
#
# ⚠️ A NEGATIVE delta is real money leaving the till, so it needed three things
# beyond the data: totals.js floors a line at £0 (one required single-select
# cannot stack, but a cheap item with a big deduction would otherwise go
# negative and eat the rest of the basket), menu-store.js had to stop rejecting
# negative choice prices (it would have refused EVERY back-office menu save
# while this existed), and both UIs had to learn to print "−£2.50" instead of
# "+£-2.50".
# Groups deleted outright, by label (lowercased), across EVERY category.
#
# OWNER'S DECISION, 18 Sep 2026: "Chip spice" asked a required question — Chip
# Spice or No Chip Spice, both £0.00 — on 7 items, for something the shop just
# does. A forced tap that carries no money and no information. Removed from both
# files together, so menu.json keeps no orphan modifiers and the build's parity
# check stays happy.
DROP_GROUPS = {'chip spice'}

EXTRA_CHOICES = {
    'burgers': {'Chips': [('No chips', -2.50)]},
}

# Pre-selected EVERYWHERE — till and website both honour `default: true`. Use
# this only where the shop wants the customer to get the choice without asking;
# POS_DEFAULTS below is the till-only version.
#
# OWNER'S DECISION, 18 Sep 2026: burgers come with chips on the website too, so
# Chips is ticked and "No chips" is the deliberate opt-out. Note this survives
# ordering.forceRequiredChoice on the website — that flag only suppresses the
# IMPLICIT first-choice auto-tick, never an explicit default.
DEFAULT_CHOICES = {
    'burgers': {'chips': 'chips'},
    # Parmesans come with chips too, and unlike the burgers there is no "No
    # chips" opt-out to explain — so pre-ticking the £0.00 choice just removes a
    # pointless tap. On the website as well, matching the burgers: the
    # force-a-choice flag only suppresses the IMPLICIT first-choice tick, never
    # an explicit default.
    'parmesans': {'chips': 'chips'},
}

# Till-only defaults for ONE named item, where the category would be too broad.
# Keyed by item name, lowercased. Checked in addition to POS_DEFAULTS below.
#
# OWNER'S DECISION, 18 Sep 2026: the wings open on 6pcs. Deliberately NOT done
# at category level: Chicken Dippers shares the identical 6pcs/10pcs group and
# was not asked for. 6pcs is the £0.00 choice (10pcs is +£3.30 on the wings,
# +£4.60 on the dippers), so the assertion below passes either way.
POS_DEFAULTS_ITEMS = {
    'spicy hot wings': {'size': '6pcs'},
    'bbq wings':       {'size': '6pcs'},
}

POS_DEFAULTS = {
    'pizza':        {'size': '11"', 'crust': 'thick'},
    'vegan pizzas': {'size': '11"', 'crust': 'thick'},
    'garlic bread': {'size': '11"', 'crust': 'thick'},
    # Salad is a required single-select, Salad / No salad, BOTH £0.00 — so the
    # default costs nothing either way and staff untick it when someone says no.
    # The identical group also exists on Kebabs (5 items), Wraps (6), Special
    # Offers (4) and Specials (1); the owner asked for burgers, so only burgers.
    'burgers':      {'size': '1/4lb', 'salad': 'salad'},   # 1/2lb is +£1.00 to +£1.50
    'kebabs':       {'size': 'medium'},         # Large is +£1.40 / +£2.00
}
# Left on "Choose…" deliberately: Specials, whose Size is 6pcs (£0.00) / 10pcs
# (+£3.30 or +£4.60). The owner has not asked for it, and a portion count is the
# kind of thing worth a staff member's deliberate tap. Add 'specials':
# {'size': '6pcs'} here if that changes.


def slug(s, maxlen=48):
    s = unicodedata.normalize('NFKD', str(s or ''))
    s = s.encode('ascii', 'ignore').decode('ascii').lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:maxlen].strip('-') or 'x'


def default_for(category, group, choice):
    """Is this the pre-selected choice EVERYWHERE (till + website)?"""
    rules = DEFAULT_CHOICES.get(str(category or '').strip().lower())
    if not rules:
        return False
    want = rules.get(str(group or '').strip().lower())
    return want is not None and want == str(choice or '').strip().lower()


def pos_default_for(category, group, choice, item=None):
    """Is this the till's pre-selected choice? Item rule first, then category."""
    g = str(group or '').strip().lower()
    c = str(choice or '').strip().lower()
    for rules in (POS_DEFAULTS_ITEMS.get(str(item or '').strip().lower()),
                  POS_DEFAULTS.get(str(category or '').strip().lower())):
        if rules and rules.get(g) is not None:
            return rules[g] == c
    return False


def pence(v):
    """Pounds -> pence. Round half-up on the exact decimal, never float-floor."""
    if v is None or v == '':
        return None
    return int(round(float(v) * 100))


def load(path):
    import xlsx
    sheets = dict(xlsx.load(path))

    def table(name, header_row=2):
        rows = sheets[name]
        idx = {h: i for i, h in enumerate(rows[header_row]) if h}
        body = [r for r in rows[header_row + 1:] if r and any(c is not None for c in r)]
        return idx, body

    return {k: table(k) for k in ('Menu', 'Variants', 'Modifier groups', 'Modifier choices')}


def cell(row, idx, key):
    i = idx.get(key)
    return row[i] if i is not None and i < len(row) else None


def build(path):
    T = load(path)
    mi, menu_rows = T['Menu']
    vi, var_rows = T['Variants']
    gi, grp_rows = T['Modifier groups']
    ci, cho_rows = T['Modifier choices']

    variants = defaultdict(list)
    for r in var_rows:
        variants[cell(r, vi, 'Item ID')].append(
            (cell(r, vi, 'Variant / size'), cell(r, vi, 'Exact price')))

    groups = {}
    for r in grp_rows:
        groups[cell(r, gi, 'Group ID')] = {
            'item': cell(r, gi, 'Item ID'), 'ctx': cell(r, gi, 'Variant context'),
            'order': cell(r, gi, 'Group order'), 'name': cell(r, gi, 'Group name'),
            'req': cell(r, gi, 'Requirement'), 'sel': cell(r, gi, 'Selection type'),
            'min': cell(r, gi, 'Minimum selections'), 'max': cell(r, gi, 'Maximum selections'),
        }

    choices = defaultdict(list)
    for r in cho_rows:
        choices[cell(r, ci, 'Group ID')].append(
            (cell(r, ci, 'Choice order'), cell(r, ci, 'Choice'), cell(r, ci, 'Surcharge')))

    # item -> (order, name) -> ctx -> [(choice order, label, surcharge)]
    by_item = defaultdict(lambda: defaultdict(dict))
    meta = {}
    for gid, g in groups.items():
        key = (g['order'], g['name'])
        by_item[g['item']][key][g['ctx']] = sorted(choices.get(gid, []))
        meta[(g['item'], key)] = g

    cats_menu, cats_visual = OrderedDict(), OrderedDict()
    skipped, seen_ids = [], {}
    stats = {'items': 0, 'mods': 0, 'by_size': 0, 'sized_items': 0, 'no_promo': 0,
             'dropped_size_groups': 0, 'pos_defaults': 0,
             'defaults': 0, 'extra_choices': 0, 'dropped_groups': 0}

    for r in menu_rows:
        iid, cat, name = cell(r, mi, 'Item ID'), cell(r, mi, 'Category'), cell(r, mi, 'Item')
        desc, avail = cell(r, mi, 'Description'), cell(r, mi, 'Availability')

        vs = [(lbl, p) for lbl, p in variants.get(iid, []) if isinstance(p, (int, float))]
        if not vs:
            # No priced variant at all. The two that hit this are sold out with a
            # blank price; shipping them would put a £0 orderable item on the menu.
            skipped.append((iid, cat, name, avail))
            continue
        vs.sort(key=lambda t: t[1])
        base_label, base_price = vs[0]

        item_id = '%s-%s' % (slug(cat, 24), slug(name, 40))
        if item_id in seen_ids:
            seen_ids[item_id] += 1
            item_id = '%s-%d' % (item_id, seen_ids[item_id])
        else:
            seen_ids[item_id] = 1

        size_ids = {lbl: 'sz-' + slug(lbl, 12) for lbl, _ in vs}
        mods, opts = [], []

        if len(vs) > 1:
            stats['sized_items'] += 1
            ch = []
            for lbl, p in vs:
                d = pence(p) - pence(base_price)
                mods.append({'id': size_ids[lbl], 'label': lbl, 'priceDeltaP': d})
                cho = {'id': size_ids[lbl], 'label': lbl, 'price': round(d / 100, 2)}
                if pos_default_for(cat, 'Size', lbl, name):
                    assert d == 0, ('POS_DEFAULTS points at a PRICED size: %s / %s (+%dp)'
                                    % (cat, lbl, d))
                    cho['posDefault'] = True
                    stats['pos_defaults'] += 1
                ch.append(cho)
            opts.append({'id': 'size', 'label': 'Size', 'select': 'single',
                         'required': True, 'choices': ch})

        variant_labels = {lbl for lbl, _ in vs}
        for key in sorted(by_item.get(iid, {}), key=lambda k: (k[0] or 0, str(k[1]))):
            per_ctx = by_item[iid][key]
            g = meta[(iid, key)]
            order, gname = key

            # The workbook says sizes TWICE: once in the Variants sheet and once
            # as an ordinary modifier group (199 of them, named "Size", carrying
            # the same surcharges). Emitting both gave the customer the same
            # required question twice and DOUBLE-CHARGED the size — picking 15"
            # in both groups added £4.00 twice. Caught by rendering the item and
            # seeing two Size groups, not by any check in the build.
            #
            # Dropped by comparing choice labels against the item's variant
            # labels rather than by matching the name "Size": a name match would
            # be guesswork, whereas an identical label set IS the duplication.
            # Verified against the workbook — this removes exactly 199 groups
            # across exactly the 72 multi-variant items, leaves no "Size"-named
            # group behind, and no item loses its sizes.
            if len(vs) > 1:
                labels = {lbl for _, lbl, _ in next(iter(per_ctx.values()))}
                if labels == variant_labels:
                    stats['dropped_size_groups'] += 1
                    continue
            # Groups the owner has had removed outright (see DROP_GROUPS). Skipped
            # BEFORE any modifier is appended, so menu.json gains no orphan ids
            # and the build's visual/server parity check has nothing to compare.
            if str(gname or '').strip().lower() in DROP_GROUPS:
                stats['dropped_groups'] += 1
                continue
            opt_id = 'g%s-%s' % (order, slug(gname, 28))
            base_ctx = base_label if base_label in per_ctx else next(iter(per_ctx))
            ch = []
            for corder, label, _ in per_ctx[base_ctx]:
                cid = 'g%s-%s' % (order, slug(label, 34))
                surch = {c: s for c, rows_ in per_ctx.items()
                         for o, l, s in rows_ if l == label for c in [c]}
                base_s = pence(surch.get(base_ctx, 0)) or 0
                by_size = {size_ids[c]: pence(s) for c, s in surch.items()
                           if c in size_ids and c != base_ctx and pence(s) != base_s}
                mod = {'id': cid, 'label': label, 'priceDeltaP': base_s}
                cho = {'id': cid, 'label': label, 'price': round(base_s / 100, 2)}
                # Pre-select on the till? Display-only, so it goes on the visual
                # side only — menu.json prices whatever ids are submitted and has
                # no concept of a default.
                if pos_default_for(cat, gname, label, name):
                    assert base_s == 0, ('POS_DEFAULTS points at a PRICED choice: %s / %s / %s (+%dp)'
                                         % (cat, gname, label, base_s))
                    cho['posDefault'] = True
                    stats['pos_defaults'] += 1
                if default_for(cat, gname, label):
                    assert base_s == 0, ('DEFAULT_CHOICES points at a PRICED choice: %s / %s / %s (+%dp)'
                                         % (cat, gname, label, base_s))
                    cho['default'] = True
                    stats['defaults'] += 1
                if by_size:
                    mod['priceDeltaPBySize'] = by_size
                    cho['priceBySize'] = {k: round(v / 100, 2) for k, v in by_size.items()}
                    stats['by_size'] += 1
                mods.append(mod)
                ch.append(cho)

            # Injected choices the workbook does not carry (see EXTRA_CHOICES).
            for xlabel, xprice in EXTRA_CHOICES.get(str(cat or '').strip().lower(), {}).get(gname, []):
                xid = 'g%s-%s' % (order, slug(xlabel, 34))
                assert not any(c['id'] == xid for c in ch), 'EXTRA_CHOICES collides: %s' % xid
                mods.append({'id': xid, 'label': xlabel, 'priceDeltaP': pence(xprice)})
                ch.append({'id': xid, 'label': xlabel, 'price': round(pence(xprice) / 100, 2)})
                stats['extra_choices'] += 1

            single = str(g['sel'] or '').lower().startswith(('single', 'optional single'))
            required = g['req'] == 'Required'
            opt = {'id': opt_id, 'label': gname,
                   'select': 'single' if single else 'multi',
                   'required': required, 'choices': ch}
            # min/max are gated in the order page: absent keeps the plain
            # required/optional behaviour. Only worth emitting for a multi group
            # that asks for an exact number ("choose 2 toppings"), which a bare
            # `required` would let a customer satisfy with one.
            if not single:
                lo, hi = g['min'], g['max']
                if isinstance(lo, int) and lo > 1:
                    opt['min'] = lo
                if isinstance(hi, int) and hi >= 1:
                    opt['max'] = hi
            opts.append(opt)

        stats['items'] += 1
        stats['mods'] += len(mods)
        no_promo = cat in NO_PROMO_CATEGORIES
        if no_promo:
            stats['no_promo'] += 1

        m_item = {'id': item_id, 'name': name, 'priceP': pence(base_price)}
        v_item = {'id': item_id, 'name': name, 'price': round(pence(base_price) / 100, 2)}
        if desc:
            v_item['desc'] = desc
        if no_promo:
            m_item['noPromo'] = True
            v_item['noPromo'] = True
        if mods:
            m_item['modifiers'] = mods
        if opts:
            v_item['options'] = opts

        cid_ = slug(cat, 28)
        cats_menu.setdefault(cid_, {'id': cid_, 'name': cat, 'items': []})['items'].append(m_item)
        cats_visual.setdefault(cid_, {'id': cid_, 'name': cat,
                                      'icon': ICONS.get(cat, '🍽️'), 'items': []})['items'].append(v_item)

    return list(cats_menu.values()), list(cats_visual.values()), skipped, stats


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        sys.exit('usage: python3 tools/_gen-dominic-menu.py <workbook.xlsx>')
    menu, visual, skipped, stats = build(src)
    (OUT / 'menu.json').write_text(json.dumps(menu, indent=2, ensure_ascii=False) + '\n')
    (OUT / 'menu-visual.json').write_text(json.dumps(visual, indent=2, ensure_ascii=False) + '\n')

    print('categories      %d' % len(menu))
    print('items           %d' % stats['items'])
    print('  sized items   %d' % stats['sized_items'])
    print('  noPromo       %d (bundles held out of the percentage promo)' % stats['no_promo'])
    print('modifiers       %d' % stats['mods'])
    print('  size-priced   %d' % stats['by_size'])
    print('dropped         %d duplicate size groups (the workbook states sizes twice)'
          % stats['dropped_size_groups'])
    for f in ('menu.json', 'menu-visual.json'):
        print('%-16s %6.0f KB' % (f, (OUT / f).stat().st_size / 1024))
    if skipped:
        print('\nSKIPPED — no priced variant, so they would have shipped as £0 items:')
        for iid, cat, name, avail in skipped:
            print('  %-9s %-14s %-24s (%s)' % (iid, cat, name, avail))


if __name__ == '__main__':
    main()
