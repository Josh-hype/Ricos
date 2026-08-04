# Layout scratchpad (`?edit=1`)

A drag-and-drop tool for deciding **where things should go** on a shop's
landing page, without describing positions in chat. The owner moves blocks
around on the real page, then copies a report; the offsets get converted into
real layout CSS afterwards.

It lives in `templates/editor.js` — **shared, one copy for every shop**. The
build ships it to `public/assets/editor.js` on every deploy.

---

## Adding it to a new shop

Two things go in that shop's `index.html`, both inside one `<script>` just
before `</body>`:

```html
<script>
  if (new URLSearchParams(location.search).get("edit") === "1") {
    window.LAYOUT_EDITOR_BLOCKS = [
      ["Hero headline", ".hero h1"],
      ["Hero paragraph", ".hero-lead"],
      ["Order button",  ".hero-ctas"],
      ["Food image",    ".hero-food"],
      ["Footer",        "footer .wrap"]
    ];
    var s = document.createElement("script");
    s.src = "/assets/editor.js";
    s.defer = true;
    document.head.appendChild(s);
  }
</script>
```

That's it. `[label, selector]` pairs — the label is what the owner sees in the
dropdown. Selectors that match nothing are skipped, so one list can cover
variations between pages.

**Nothing is downloaded on a normal visit.** The editor is a separate file
fetched only when `?edit=1` is present, and it exits immediately if the flag is
missing or no block list is defined.

---

## What it does

- Tap a block to select it; tap again and drag to move it
- Arrows nudge 10px; X/Y fields take exact numbers
- **Size %** (20–300), **Flip ↔ / ↕**, **Turn °** (5° and 90° steps)
- Panel starts folded to a bar; the header shows what's selected
- Tap empty space to deselect
- **Copy for Claude** produces the report to paste back

Offsets live in `localStorage`, keyed by hostname **and** by desktop/mobile, so
the two layouts are edited separately and two shops never share state. Nothing
is written to the site.

---

## Why the report is not paste-able CSS

The preview applies everything with the CSS `translate`, `scale` and `rotate`
properties. Those move an element **visually without moving its layout box** —
the space it used to occupy stays reserved.

Pasting those numbers into a stylesheet is what put ~300px holes in the Big
Bites page and slid whole sections under the sticky header. So the report is a
statement of intent, and it gets rebuilt as real layout — margins, offsets,
grid placement, font sizes — which move the box too.

### Reading a report

Two kinds of number come back, and they need opposite treatment:

- **Real intent** — "the chicken should be 40px left".
- **Compensation for the preview itself.** `scale` grows from the *centre*, so
  shrinking a text block pushes its left edge inward and the owner drags it
  back. That x-shift must be **discarded**: cutting `font-size` instead shrinks
  from the left edge and stays aligned on its own.

Same trap vertically: shrink a headline and everything below rises for real, so
the individual "move this up 35px" drags on the blocks beneath it are already
accounted for. Applying them as well doubles the movement.

Sub-10px values are usually accidental drags. Confirm rather than apply.

### The offsets are cumulative

`localStorage` keeps them until reset, so a second report includes everything
from the first — including whatever has since been baked into the CSS. Tell the
owner to hit **Reset all** after each round, and diff against the previous
report before applying anything.

---

## Gotchas already hit

- **`touch-action`.** Without it the browser claims a touch-drag as a scroll and
  cancels the pointer stream about a second in — the block moves, then stops
  dead. Only the *selected* block sets `touch-action: none`, so everywhere else
  still scrolls. Dragging also takes a pointer capture, and `pointermove` is
  registered non-passive so `preventDefault()` actually works.
- **Select first, then drag.** One gesture each. Dragging anything under the
  finger made the whole page feel stuck.
- **Blocks that can never be the pointer target.** A decorative image behind a
  copy layer (`z-index`, or `pointer-events: none`) never receives the tap. The
  editor re-enables pointer events on managed blocks while open, and falls back
  to hit-testing their boxes, taking the smallest match.
- **A tap is not a drag.** A press that never moves more than a few pixels
  deselects; one that moves drags or scrolls.
