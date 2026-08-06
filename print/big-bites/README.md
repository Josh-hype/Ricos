# Big Bites — A3 trifold menu (print)

    node print/big-bites/build-menu.mjs   # data -> menu.html
    node print/big-bites/render.mjs       # menu.html -> PDF + preview.png

Prices come from `data/shops/food-station/menu-visual.json` and the phone,
address, hours and delivery terms from `config.json` — the same files the
website and the till use. **Change a price there, re-run these two commands,
reprint.** The printed menu cannot drift from what you actually charge.

## Spec

- **426 × 303 mm** = A3 landscape (420 × 297) + **3 mm bleed** all round
- Three **140 mm** panels per side, double-sided (2 pages)
- Fold guides are the dashed lines between panels — they do not print as marks,
  so tell the printer it is a trifold and which way
- Equal thirds suit a **Z / concertina fold**. For a **roll fold** the tucked
  panel wants ~2 mm shaving; the printer will advise
- QR is **vector** (segno, error correction H) pointing at
  https://bigbiteseasingwold.co.uk

## Typefaces

**Oswald** — Bold for the plaques, spine, kids ribbon, deal titles, phone
number and ticker; Regular/Medium for the price lists. **Montserrat** for
marketing copy: the dips list, deal-card bodies, and the cover's delivery and
opening-hours block. Both vendored in `fonts/`; nothing is fetched.

Two families, because the reference uses two. Its headings measure ~0.65
advance-per-letter against cap height — Anton is 0.54 (too narrow) and Archivo
Black 1.12 (much too wide), so the display face is the *same* condensed family
as the lists, just heavy and about 2.8x their cap height. Its marketing copy is
a normal-width sans, measured 34% wider than its price lists.

`render.mjs` refuses to write the PDF unless both families loaded — **and then
reads the finished PDF's own font list**, deleting the file if anything outside
the repo got embedded. A name-only check cannot catch that: `document.fonts.check()`
returns true for a family even when the glyph asked for is missing from it,
which is how ★ and → were quietly pulling DejaVu off the build machine. Both
are inline SVG now.

Note for the printer: the vendored Montserrat files carry the family string
"Montserrat Thin" in their name table, so preflight will report
`MontserratThin-*`. The outlines are genuine Regular/SemiBold/Bold — verified
by stem width — so this is cosmetic.

## Presentation vs. data

A few things are set differently from how the menu data reads, to match the
reference. None of them change what is on sale or what it costs:

- **Milk Shakes** lists flavours only — the repeated "Milkshake" comes off —
  and folds the coolers into one *Cooler* row with the flavours named
  underneath, instead of a row each.
- **Descriptions** print in red, bracketed, Title Case, with the shop's
  trailing full stop removed. Pizza inverts it: gold names, white toppings,
  no brackets.
- **Prices** carry no currency mark anywhere on the sheet.

## Panel order

Follows the designer's artwork exactly. `build-menu.mjs` has the same note —
don't reshuffle without checking the reference sheets again.

| | left panel | middle panel | right panel |
|---|---|---|---|
| **outer** | Drinks · Milk Shakes · Desserts · Kids | Dips · Meal Deals | **cover** |
| **inner** | Pizza | Garlic Bread · Calzone · Kebabs · Parmesan · Wrap | Burgers · Sides · Salad |

The inner middle panel carries five sections against three elsewhere, so it
runs on tighter leading (`.panel.tight`) — again, as the reference does.

## Assets still needed

Seven gaps. Each one is a hole the reference fills and this sheet currently
leaves empty — nothing is faked or substituted.

| # | Asset | Where it goes | Spec |
|---|-------|---------------|------|
| 1 | **Burger, on its own** | Burgers, inner right panel — the panel's empty upper right | Transparent PNG, ≥1200px wide. The supplied sheet welds the burger to the nuggets and the cola, so it can't be cut free without a visible slice |
| 2 | **Garlic bread** | Garlic Bread, inner middle panel | Transparent PNG, ≥1000px wide |
| 3 | **Parmesan** | Parmesan, inner middle panel | Transparent PNG, ≥1000px wide |
| 4 | **Drink cans** | Drinks, outer left panel | Real Pepsi + Coca-Cola. The generated pair spell "pepc" and a garbled Coca-Cola script — a printed menu carrying a botched trademark is not something to send to press. The brands' own press images are the safe source |
| 5 | **Kids Menu ribbon lockup** | Inside the red Kids box, replacing the plain type there now | "KIDS MENU / BIG BITES" ribbon with the cutlery and food illustrations, transparent PNG ≥1200px wide |
| 6 | **Cover background** | Lower half of the cover panel | The pizza / basil / tomato flood. No transparency needed, but it must be big: ~1500 × 1800px |
| 7 | **Bigger burger hero** | Above Meal Deals — already in place, but soft | The current file is 635px, which is 149dpi at 108mm — every build prints the dpi table, and the build throws below 140. ≥1200px wide puts it over 300 |

Everything else on the sheet is either live menu data or generated here (the
plaques, the halftone, the torn deal-box edges, the phone and clock icons, the
QR) and needs no artwork.

## Before sending to print

    node print/big-bites/check-collisions.mjs

reports any item name or price that runs under a food photo — run it after
resizing one. It measures the rendered glyphs, not the boxes.

`render.mjs` reports `panels fit` or lists any panel whose content overruns its
box. Never send a PDF that reported an overflow — content will be cut at the
fold.

The PDF is **RGB**. Most printers convert, but ask: if they want CMYK supplied,
convert with Ghostscript or ask them to do it.

It carries a **TrimBox** of 420×297mm centred in the 426×303 sheet, so preflight
reads the trim geometrically rather than relying on being told. There are no
crop marks and no OutputIntent — say so when you send it.

**Bleed is real, not decorative.** The outer panels are 143mm wide, not 140:
that extra 3mm strip IS the bleed and belongs to the panel, so plaques, photos
and the spine run off the sheet instead of being clipped exactly on the trim
line. Giving the page the padding instead — which is what this did originally —
put a hard cut on the trim and left a dark hairline wherever the guillotine
drifted outward.

## Errors this replaced

Checked against live data. The ChatGPT-generated artwork had:

- phone **824522** — the real number is **820820**. **The designer's sheets
  carry the same wrong number.** It is the old Food Station line; the owner
  confirmed 820820 on 2026-07-30 (see the note in `config.json`). Worth having
  the designer correct it wherever else that artwork is used
- **Drinks priced can-only.** The designer's sheet has Can/Bottle columns and
  the menu data has the bottle option (+£2.00); the first draft here printed
  only the can price, so a bottle looked like £1.50
- **Kids Sunny with no detail** — its choice ("(4) & chips or Tenders (3) &
  chips") lives in a required option rather than a description field
- Burger Sauce and Chilli Mayo priced at **£1.90**; they are £1. The £1.90 pots
  are **Pot Curry** and **Pot Gravy**
- "COLDER" instead of Mango Cooler / Strawberry Cooler
- "Can of Coke£12" — price collided with the item
- "FRESH & LOADDED" in the footer ticker
- "WEBSITE.WEBSITE" placeholder and a QR pointing nowhere
