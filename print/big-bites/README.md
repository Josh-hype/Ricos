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
| 7 | **Bigger burger hero** | Above Meal Deals — already in place, but soft | The current file is 635px, which is 168dpi at 96mm. ≥1200px wide puts it back over 300 |

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
