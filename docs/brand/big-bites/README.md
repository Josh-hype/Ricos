# Big Bites — vector brand kit

True vector (SVG) versions of the Big Bites logo and the graphic toolkit, plus
high-resolution PNG exports for the places that won't take an SVG.

Everything here is **real outline geometry**. There is no live text and no font
dependency, so the files open the same in Illustrator, Inkscape, Affinity,
Canva, a browser, or a printer's RIP — nobody needs Luckiest Guy installed to
open them. Scale them to a shop sign or down to a favicon; they stay sharp.

---

## Which file do I send?

| I need… | Send this |
|---|---|
| The logo, normal use (menus, socials, signage, van) | `svg/bigbites-logo-stacked.svg` |
| The logo on a photo or a coloured panel | `svg/bigbites-logo-stacked-knockout-bite.svg` |
| The logo in a wide/short space (website header, banner) | `svg/bigbites-logo-horizontal.svg` |
| One-colour print, vinyl cutting, embroidery, a stamp | `svg/bigbites-logo-stacked-black.svg` (or `-white`, `-yellow`) |
| App icon / Facebook & Instagram avatar | `svg/bigbites-app-icon.svg` |
| Website tab icon | `svg/bigbites-favicon.svg` |
| An offer flash ("2 for £15", "Slice it!") | `svg/bigbites-tab-*.svg` |
| Your own offer wording on a brand tab | `svg/bigbites-tab-blank.svg` |
| Something that won't accept an SVG (WhatsApp, some printers) | anything in `png/` |

**Print shops and sign makers: send them the SVG, not the PNG.** If they insist
on a PDF or EPS, opening the SVG in Illustrator or Inkscape and saving as PDF/EPS
loses nothing — it is already vector.

---

## Everything in the kit

### Logo

| File | What it is |
|---|---|
| `bigbites-logo-stacked.svg` | The primary lockup: BIG over BITES, yellow faces, red 3D extrude, dark keyline, charcoal bite. Transparent background. |
| `bigbites-logo-stacked-knockout-bite.svg` | Same, but the bite is a genuine hole — the background shows through. Use on photos and colour. |
| `bigbites-logo-stacked-black.svg` | One colour, charcoal. Bite knocked out. |
| `bigbites-logo-stacked-white.svg` | One colour, white. |
| `bigbites-logo-stacked-yellow.svg` | One colour, brand yellow. |
| `bigbites-logo-horizontal.svg` | BIG BITES on one line — for wide, short spaces. |
| `bigbites-logo-horizontal-black.svg` / `-white` / `-yellow` | One-colour horizontal. |

### Location lockups

| File | What it is |
|---|---|
| `bigbites-lockup-easingwold.svg` | Logo with a **★ EASINGWOLD** strap. Charcoal strap — for cream, white, yellow or red backgrounds. |
| `bigbites-lockup-easingwold-on-dark.svg` | Same with a yellow strap — for charcoal and photos. |
| `bigbites-lockup-selby.svg` / `-on-dark.svg` | The Selby pair. |

Need another town? See "Regenerating" below — it's one line.

### Graphic toolkit

| File | What it is |
|---|---|
| `bigbites-bite-mark-red.svg` / `-black.svg` | The signature chomp. Use as a bullet, a stamp, or chomped out of shapes and photos. |
| `bigbites-tab-slice-it.svg` | The slanted red **SLICE IT!** tab. |
| `bigbites-tab-fresh-and-loaded.svg` | **FRESH & LOADED** tab. |
| `bigbites-tab-2-for-15.svg` | **2 FOR £15** offer tab. |
| `bigbites-tab-blank.svg` | Empty tab to drop your own wording into. |
| `bigbites-ticker-strip.svg` | The SLICE IT ★ BIG BITES ★ FRESH & LOADED band. Tiles horizontally — crop it to any width. |
| `bigbites-dotted-rule.svg` | The red dashed divider. |
| `bigbites-star-red.svg` / `-yellow.svg` | The brand star on its own. |

### PNG exports (`png/`)

Transparent background, for anything that won't take an SVG. Regenerate at any
size from the SVGs rather than scaling these up.

`bigbites-logo-stacked-2048.png` · `bigbites-logo-stacked-white-2048.png` ·
`bigbites-logo-horizontal-2048.png` · `bigbites-app-icon-1024.png` ·
`bigbites-tab-slice-it-1600.png` · `bigbites-lockup-easingwold-2048.png`

---

## Colours

| Name | Hex | RGB | CMYK |
|---|---|---|---|
| Big Bites Yellow | `#F7C61A` | 247 · 198 · 26 | 0 · 20 · 89 · 3 |
| Bite Red | `#E32619` | 227 · 38 · 25 | 0 · 83 · 89 · 11 |
| Charcoal | `#0C0C0C` | 12 · 12 · 12 | 0 · 0 · 0 · 95 |
| Cream | `#FBF3DE` | 251 · 243 · 222 | 0 · 3 · 12 · 2 |
| Deep Red | `#A81409` | 168 · 20 · 9 | 0 · 88 · 95 · 34 |
| Off White | `#FFFDF7` | 255 · 253 · 247 | 0 · 1 · 3 · 0 |

Roughly **60% charcoal / 30% yellow / 10% red** across any layout.

## Type

- **Display / headlines — Luckiest Guy.** Always uppercase. Logo, big headlines,
  menu categories, offers. Never body text or small print.
- **Body / UI — Montserrat.** Regular 400 for descriptions, Bold 700 /
  ExtraBold 800 for labels and buttons.

Both are free from Google Fonts. Luckiest Guy is by Astigmatic, under the SIL
Open Font License 1.1, which allows commercial use and converting glyphs to
outlines — which is exactly what this kit is:
<https://fonts.google.com/specimen/Luckiest+Guy>

## Rules

- Clear space on all sides = at least the height of the **B**.
- Minimum width **22 mm** in print / **120 px** on screen.
- Preferred background is charcoal. It also works on Bite Red, on yellow, and on
  white/cream.
- Don't stretch or squash it, don't recolour the faces, don't rotate or tilt it,
  and **don't drop the bite** — it's the most ownable part of the mark.
- Tabs are always red and always tilted a few degrees.

---

## Regenerating / extending

`build-kit.py` generates every SVG here from the Luckiest Guy outlines:

```sh
cd docs/brand/big-bites
pip install fonttools uharfbuzz
curl -o LuckiestGuy-Regular.ttf \
  https://fonts.gstatic.com/s/luckiestguy/v25/_gP_1RrxsjcxVyin9l9n_j2RSg.ttf
BB_OUT=svg python3 build-kit.py
```

A new town lockup or a new offer tab is one line in `main()`:

```python
write('bigbites-lockup-york.svg', build_lockup('York', strap=CHAR))
write('bigbites-tab-3-for-20.svg', build_tab('3 FOR £20'))
```

### How the proportions were set

The vector is a reconstruction of the approved raster lockup
(`data/shops/food-station/logo.png`, 914×652), and its proportions were
**measured off that file's pixels**, not eyeballed: letter tracking, line
spacing, keyline weight, the 3D extrude offset and the bite circles were all
read from the raster and expressed as fractions of the cap height. Re-exported
at 2048 px and measured the same way, the vector matches the original on
BIG/BITES width ratio, line spacing, keyline weight, extrude offset and overall
aspect ratio to within 0.5%.

If you change a constant at the top of `build-kit.py`, re-check it against the
raster before shipping.

### Notes for whoever edits these next

- Every internal `id` is namespaced to its filename, so two of these can be
  inlined in the same HTML page without their masks colliding.
- The full-colour logos build the 3D extrude by sweeping 32 `<use>` copies of
  each outline along the offset vector, filled *and* stroked in one colour, so
  the silhouette has no internal seams and the red body sits inside it — that's
  what produces the dark keyline. The hairline `SEAM` stroke on the red body
  closes the sweep's stair-steps.
- The one-colour variants are deliberately plain flattened `<path>`s, because
  cutting and embroidery software is the least forgiving consumer.
