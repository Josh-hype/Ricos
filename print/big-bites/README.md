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

**Archivo** (two static instances cut from the variable font) for the section
plaques, the spine wordmark and address, kids ribbon, phone number and ticker
straps. The spine was Montserrat until the owner called it off-brand: it had
been matched to the ChatGPT reference, whose spine sets in a normal-width face
— but the reference is not the brand, and a normal-width wordmark on the one
edge you see folded read as a different shop next to the sheet's own plaques.
**Oswald** Medium for the price lists. **Montserrat** for marketing copy: the
dips list, deal cards, the spine wordmark and the cover's delivery and
opening-hours block. All vendored in `fonts/`; nothing is fetched.

The display face is chosen by two measurements taken off the reference at
matched cap height — **stem/cap** (how heavy) and **advance/cap** (how wide):

| face | stem/cap | advance/cap |
|------|---------:|------------:|
| *reference, inner face* | **0.266** | **0.665** |
| *reference, outer face* | **0.322** | **0.767** |
| Archivo wght900 wdth62 | 0.266 | 0.673 | 
| Archivo wght900 wdth75 | 0.285 | 0.800 |
| Barlow Condensed Black | 0.269 | 0.648 |
| Oswald Bold | 0.221 | 0.644 |
| Anton | 0.193 | 0.510 |

Read off the outlines with fontTools, not off a screenshot. The reference sets
its **outer** plaques heavier than its inner ones, and Archivo is a two-axis
variable font, so both come from real static instances: `wdth 62` matches the
inner target to within 1% on cap height, weight and width; `wdth 75` matches
the outer on width exactly and is 11% light on weight.

**That 11% is deliberate.** An earlier attempt closed it with
`-webkit-text-stroke`, which matched the reference exactly — and made Chromium
emit the heading as a **Type 3** font. Type 3 glyphs are procedural, RIPs
render them badly and some printers reject them outright. A press defect is
not worth a type match. `render.mjs` now fails on any Type 3 in the PDF.

Anton is the trap worth naming: it looks like the obvious heavy poster answer
and is *lighter than Oswald* relative to its cap, because it is a tall-cap
face.


`render.mjs` refuses to write the PDF unless every family loaded — **and then
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
- **Burgers without a size option** print their single price in the column
  their own description names — the Piggy Burger is a ½lb, so its £10 sits
  under *1/2 lb* and *1/4 lb* shows a dash. An item whose text claims both
  sizes throws rather than being placed by guesswork.
- **Delivery terms** say *minimum **delivery** order*, and state the online
  service charge. Both are what `functions/_lib/totals.js` actually applies:
  the minimum is delivery-only, the charge is on every web order including
  collection. Both derive from `config.json`.

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

The owner replaced most of the missing artwork on 2026-08-06: the **Kids Menu
lockup**, the **cover pizza**, then `hero`, `parmasan`, `calzone` and
`doner-pit`. Eleven photographs are placed — the cover pizza, the meal-deal
lockup, the pizza, cake, shake, wrap, calzone, parmesan, doner spit, the drink
cans and the Sides/Salad column.

The drink cans on the sheet are **`new-pepsi-coke.png`**, placed byte for byte
as the owner supplied it — no key, no trim, no edit of any kind. It arrives as
a 1024×1536 canvas carrying a 741×726 photograph, so it is placed with
`shot(..., { ink: true })`: the build reads the PNG's alpha channel (pure Node,
`zlib` is a built-in) and lays the photo out by where the *picture* is rather
than by the size of the canvas. Without that the cans print a third of the size
of the space reserved for them, and the empty frame overruns the panel.

### The earlier cans, and why `pepsi-coke.png` is generated

Kept for the record; `pepsi-coke.jpg`/`.png` are no longer on the sheet.

The owner supplied `pepsi-coke.jpg` — a stock cutout served as JPEG, so the
transparency checkerboard is baked into the pixels. It cannot be placed as
supplied: on the black panel it prints a grey chequered rectangle. **The PNG
next to it is generated from it** by `key-checkerboard.py`, and both files are
committed so the key can be re-run:

    python3 print/big-bites/key-checkerboard.py img/pepsi-coke.jpg img/pepsi-coke.png
    python3 print/big-bites/trim-alpha.py img/pepsi-coke.png

Two earlier keys shipped damaged and the owner caught the second one. Both
failed the same way — by asking "is this pixel light and neutral?", which is
equally true of the checkerboard, of an aluminium can top, of the white
Coca-Cola script, of the silver rim at a can's foot and of the white band down
the Coke can's edge. The first cut both can tops flat. The second left a dashed
black gash down the side of the Coke can: the white band keyed out inside the
white squares and stayed inside the grey ones.

The script tests **alternation**, not colour — real backdrop swings light/dark
every cell, a white can edge is flat however exactly its colour matches the
square beneath it — and measures that by correlation, which is blind to both
gain and offset and so reads the cans' cast shadow as the dimmed backdrop it
is. It ends by compositing its own output back onto a synthetic checkerboard
and comparing against the source: **0.03%** of the frame differs. Reproducing
the two shipped defects scores **0.77%** (the gash) and **6.02%** (the flat
tops), which is what the 0.3% threshold is set against — 1%, the obvious round
number, would have passed the gash.

The photograph between Dips and Meal Deals is **`hero-neww.png`**, which is a
full rectangular photograph rather than a cutout — it has no alpha channel at
all, so it sits on the panel as a picture with edges rather than as food
floating on black. It is placed at 92mm, not the 108mm the cutout before it
used: at 108mm it stands 72mm tall and overruns the panel by 10mm, because a
4:3 photograph is far deeper than the 2:1 lockup it replaced.

`sides-salad.png` is back on the inner right panel, at the width and position
it had before. `burger-meal.png` and `kebab.png` are **off the sheet** on the
owner's instruction, and stay in `img/` cut and keyed.
Putting one back is a one-line change at its section's call site — but note
that `slotOf()` returns the greater of the photo's width and the section's
`slot`, so removing a photo means releasing its gutter too or the list keeps a
hole where the picture was.

**Trim a new cutout before placing it:** `python3 print/big-bites/trim-alpha.py
img/<name>.png`. Two of the owner's four uploads were 1024×1536 canvases
carrying a picture only 576px tall sitting at the bottom, and the generator
sizes a photo by its canvas because it cannot decode a PNG past the header. The
script drops border only — every pixel it removes is alpha ≤ 16, it refuses to
run otherwise, and it checks the opaque pixel count is unchanged afterwards.

`hallumi.png` sits in the empty right-hand side of Sides, above where the
Sides/Salad column's burger begins. It carries its own red halftone, which is
the sheet's own device, so it reads as artwork rather than as a pasted cutout.

One gap left. Each is a hole the reference fills and this sheet leaves empty —
nothing is faked or substituted. The Garlic Bread list still holds a 14mm
gutter open for its missing photo.

| # | Asset | Where it goes | Spec |
|---|-------|---------------|------|
| 1 | **Burger, on its own** | Burgers, inner right panel — the panel's empty upper right | Transparent PNG, ≥1200px wide. `hero.png` has a burger in it, but it is a four-item lockup with a can and a fries carton, so it reads as a meal deal rather than as the Burgers section |
| 2 | **Garlic bread** | Garlic Bread, inner middle panel | Transparent PNG, ≥1000px wide |

### Fitting a photo to the inner middle panel

That panel carries five sections and is **full** — before these photos went on
it had 3mm of slack in 290mm. Two things cost height there, and neither is
obvious from the call site:

- **`--rowmin`** holds the row open to the photo's height + 3mm. A photo taller
  than its own list pushes the panel down by the difference: the calzone at
  46mm wide is 29mm tall against a 28mm list, so it cost 4mm. At 40mm it costs
  nothing and is barely smaller on the page.
- **The gutter wraps a description.** Any `slot` at all on Kebabs costs ~2.6mm
  (one row wraps); at 26mm a second and third wrap and it costs **14.8mm**. The
  doner spit is 18mm wide for that reason — 22mm is the last width that stays
  on the cheap side of the cliff.

The remaining 3mm came out of `.panel.tight`'s inter-section gap (2.4mm →
1.8mm), which is the same trade that panel already makes elsewhere. Nothing was
shrunk on the price lists — the type on this panel still matches the reference.

Everything else on the sheet is either live menu data or generated here (the
plaques, the halftone, the torn deal-box edges, the phone and clock icons, the
QR) and needs no artwork.

## Checking the facts

    node print/big-bites/audit-facts.mjs

Reads the finished sheet and checks it against the shop's own data from the
other direction to the build: every item in `menu-visual.json` must be on the
paper and nothing may be on the paper that is not in the data, and the phone,
address, postcode, domain, delivery terms, minimum order, radius and **all
seven days of opening hours** must match `config.json`.

It reports four things by design, all documented under *Presentation vs. data*:
the Kids box prints each meal's required-option text rather than its item name
(twice), and the two Pizza Deals fold into one box with a price per line
(twice). 147 items in the data, 146 rows on the sheet.

Its own hours check was wrong first time and passed seven days without testing
anything — `config.json` stores `windows: [{open, close}]` on each day, not
`open`/`close` directly, so reading `v.open` gave `undefined` and the check
skipped. Worth remembering when adding to it: a check that reads the wrong
field reports clean.

## Before sending to print

    node print/big-bites/check-collisions.mjs
    python3 print/big-bites/verify-qr.py
    python3 print/big-bites/verify-preview.py

**`render.mjs` runs all three itself** and refuses to write the PDF if any
fails — they are documented here because they are useful on their own,
not because anyone has to remember them.

The first reports any item name or price that runs under a food photo. It
measures the rendered glyphs, not the boxes.

The second proves `qr.svg` encodes the domain in `config.json`, module by
module, by re-encoding with segno and comparing the committed file's own path
data. The build can only compare two strings it was told; this reads the QR.
`config.json` records that the printed brand guidelines already carry a domain
the shop does not own, so a QR pointing at the wrong host is a mistake this
project has the shape of already.

The third compares `preview.png` against a raster of the PDF, block by block.
The preview is the only thing anyone reviews, and it comes from a *different*
code path — screen media, its own browser context. They diverged silently once:
an element positioned below the page box (`bottom: -4mm`) renders on screen and
is **dropped entirely** by Chromium's print path, so the cover's pizza was in
the preview and absent from the PDF while every other gate passed — because
every other gate reads the PDF or the DOM, and neither disagreed with itself.
A global mean does not move enough to notice one missing photograph; a grid of
blocks does. Good build: worst block 12/255. With that bug: 88.

`menu.html` is **generated and gitignored**. It used to be committed, which
meant a price hand-patched into it survived in git and reprinted forever; the
sheet now carries a hash of itself and `render.mjs` refuses to print one that
has been edited since it was generated.

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
