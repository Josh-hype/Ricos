# Tad Kebab — vector brand kit

Tadcaster takeaway: pizzas, kebabs, burgers. Trading name is **Tad Kebab**
(confirmed with the owner). Light and warm — cream carries it, red does the
shouting.

Everything here is **real outline geometry**. There is no live text and no font
dependency, so the files open the same in Illustrator, Inkscape, Affinity,
Canva, a browser, or a printer's RIP — nobody needs Titan One installed. Scale
them to a shop sign or down to a favicon; they stay sharp.

See `kit-sheet.png` for the whole kit at a glance.

---

## Which file do I send?

| I need… | Send this |
|---|---|
| The logo, normal use (menus, socials, signage, van) | `svg/tadkebab-logo-stacked.svg` |
| The logo on charcoal or a dark photo | `svg/tadkebab-logo-stacked-on-dark.svg` |
| The logo on red, or on a busy photo | `svg/tadkebab-logo-stacked-knockout.svg` |
| A wide, short space (website header, banner, fascia) | `svg/tadkebab-logo-horizontal.svg` |
| One-colour print, vinyl cutting, embroidery, a stamp | `svg/tadkebab-logo-stacked-black.svg` (or `-white`, `-red`) |
| Anything naming the town | `svg/tadkebab-lockup-tadcaster.svg` |
| App icon / Facebook & Instagram avatar | `svg/tadkebab-app-icon.svg` |
| Website tab icon | `svg/tadkebab-favicon.svg` |
| An offer flash | `svg/tadkebab-tab-*.svg` |
| Your own wording on a brand tab | `svg/tadkebab-tab-blank.svg` |

**Send sign makers and print shops the SVG, not a PNG.** If they insist on PDF
or EPS, open the SVG in Illustrator or Inkscape and save as PDF/EPS — it is
already vector, so nothing is lost.

---

## Everything in the kit

### Logo

| File | What it is |
|---|---|
| `tadkebab-logo-stacked.svg` | Primary: TAD over KEBAB, red faces, charcoal keyline, skewer beneath |
| `tadkebab-logo-stacked-on-dark.svg` | Cream keyline and skewer, for charcoal and dark photos |
| `tadkebab-logo-stacked-knockout.svg` | Cream faces, charcoal keyline — for red grounds and busy photos |
| `tadkebab-logo-stacked-black.svg` / `-white` / `-red` | One colour throughout |
| `tadkebab-logo-horizontal.svg` | TAD KEBAB on one line, for wide short spaces |
| `tadkebab-logo-horizontal-on-dark.svg` / `-black` / `-white` | Horizontal variants |

### Town lockups

| File | What it is |
|---|---|
| `tadkebab-lockup-tadcaster.svg` | Logo with a **TADCASTER** strap under the skewer |
| `tadkebab-lockup-tadcaster-on-dark.svg` | For charcoal grounds |
| `tadkebab-lockup-tadcaster-knockout.svg` | For red grounds |

Another town later? One line in `build-kit.py` — see Regenerating.

### Graphic toolkit

| File | What it is |
|---|---|
| `tadkebab-skewer-black.svg` / `-red` / `-cream` | The signature device on its own. Use as a divider, an underline, or a bullet |
| `tadkebab-rule.svg` | Red dashed divider for menus and price lists |
| `tadkebab-tab-off-the-grill.svg` | **FRESH OFF THE GRILL** flash |
| `tadkebab-tab-order-online.svg` | **ORDER ONLINE** flash |
| `tadkebab-tab-blank.svg` | Empty tab for your own wording |
| `tadkebab-ticker-strip.svg` | TAD KEBAB · TADCASTER · PIZZA · KEBABS · BURGERS band. Tiles horizontally — crop to any width |

### Icons

| File | What it is |
|---|---|
| `tadkebab-app-icon.svg` | Rounded red square, TAD over the skewer |
| `tadkebab-favicon.svg` | A single **T**. Nothing else survives 16px |

The icon deliberately drops KEBAB and the town. At 120px on a home screen they
are illegible, and an icon that tries to say everything says nothing.

---

## Palette

| Role | Hex | Notes |
|---|---|---|
| Cream (ground) | `#FBF2E2` | Carries the design. Everything sits on this |
| Red (primary) | `#D33A2C` | Warm tomato. Deliberately softer than Big Bites' `#E32619` so the two brands don't read as siblings |
| Deep red | `#A32419` | Held for depth effects |
| Charcoal (ink) | `#2B2119` | Brown-tinted, **not** black — a pure `#000` keyline goes cold against cream |
| Gold (accent) | `#E9A63C` | Spare accent, unused so far |

**Red letters never go on a red ground** — use the knockout. Red on cream is a
low-contrast pairing, which is exactly why the keyline is not optional: without
it the letters go muddy at small sizes.

---

## Regenerating

```
pip install fonttools uharfbuzz
python3 build-kit.py
```

Writes `svg/`. Add a town by appending to `JOBS`:

```python
('tadkebab-lockup-york.svg', lambda: build_logo(town='YORK')),
```

The fonts in `fonts/` are **committed on purpose**. The Big Bites kit depends on
a Luckiest Guy file that was never checked in, so it cannot be rebuilt from a
clean clone — that mistake is not repeated here. Titan One (wordmark) and Bowlby
One SC (straps, tabs, ticker) are both SIL Open Font License 1.1, which permits
commercial use and redistribution; see `fonts/OFL-*.txt`.

`build-concepts.py` is the earlier three-way exploration, kept for the record.

---

## Still to do

- [ ] **Show the shop.** None of this has been seen by the owner
- [ ] **Check nothing already exists.** If there is a sign or menu out there
      already, matching it may matter more to them than a clean start
- [ ] **PNG exports** — add when someone actually needs one; regenerate from the
      SVGs at the size required rather than scaling a PNG up
- [ ] **Shop folder** — `data/shops/tad-kebab/` if they take LumiWEB, which is
      still undecided
