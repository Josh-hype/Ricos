# Tad Kebab — logo concepts

Tadcaster takeaway: pizzas, kebabs, burgers. Brief was **light colours, red and
cream**, and a **bold, fun** feel rather than traditional or minimal.

**Status: concepts, awaiting a decision.** Nothing here is final and none of it
has been shown to the shop. Once a direction is picked, this becomes a full kit
in the shape of `docs/brand/big-bites/` — every lockup, one-colour variants, app
icon, favicon, PNG exports.

Look at `concepts.png` for all three on cream, on their proper dark or red
ground, and small.

---

## The three directions

| | What it is | Where it wins | Where it doesn't |
|---|---|---|---|
| **A — stacked + skewer** | TAD over KEBAB, red faces on a keyline, the skewer rule beneath | Distinctive, warm, takes a town strap, works on every ground | The most parts to reproduce; the skewer is the first thing lost when scaled small |
| **B — panel** | One line, cream knocked out of a red rounded panel | Most legible at distance, cheapest to reproduce — one colour plus the paper | Reads as a label or a button rather than a logo. No signature device |
| **C — extrude** | TAD over KEBAB with a deep-red 3D extrude | Loudest of the three, good depth, no keyline needed | Least distinctive — nothing here belongs only to Tad Kebab |

**Recommendation: A.** It is the only one with a device of its own. Big Bites has
its bite mark, and that mark does far more work across menus, boxes and socials
than the wordmark alone ever does — the skewer is the same idea for Tad, usable
as a divider, an underline or a bullet long after the logo itself is placed.

---

## Palette

| Role | Hex | Notes |
|---|---|---|
| Cream (ground) | `#FBF2E2` | Carries the design. Everything sits on this |
| Red (primary) | `#D33A2C` | Warm tomato. Deliberately softer than Big Bites' `#E32619` so the two brands don't read as siblings |
| Deep red (extrude) | `#A32419` | Concept C's shadow only |
| Charcoal (ink) | `#2B2119` | Brown-tinted, **not** black — a pure `#000` keyline goes cold against cream |
| Gold (accent) | `#E9A63C` | Unused so far. Held back for offer flashes |

---

## Regenerating

```
pip install fonttools uharfbuzz
python3 build-concepts.py
```

Writes `svg/`. The fonts live in `fonts/` and are **committed on purpose** —
the Big Bites kit depends on a Luckiest Guy file that was never checked in, so
that kit cannot be rebuilt from a fresh clone. Don't repeat that here.

All three faces are SIL Open Font License 1.1 (see `fonts/OFL-*.txt`), which
permits commercial use and redistribution. The outputs are outlined geometry
anyway, so nothing downstream needs the fonts installed.

---

## Two things to settle before this becomes a kit

- **Confirm the trading name.** Everything here is set as `TAD KEBAB`. If the
  shopfront says something else, the wordmark changes and so does the kit.
- **Ask whether a logo already exists.** If there's a sign or a menu already
  out there, matching it may matter more to them than a clean start.
