# header-plaque.png

The owner's bitten-corner plaque, used behind **every** section header and the
cover's straps. The source art was tilted 4.45°, which is levelled out here —
the header keeps a small CSS rotation instead, which is easier to tune than one
baked into the pixels. Palette-reduced to 128 colours: the mottled texture
doesn't compress as truecolour, and that alone took it from 491KB to 77KB.

It's applied as a **`border-image`**, not a background. The bite and the ragged
ends live in the corner slices and keep their shape while only the middle
stretches, so the bite comes out the same on `PIZZA` as on
`MILKSHAKES & COOLERS`. As a plain background it would smear wide on a long
header and squash on a short one.

The slice numbers (`18 85 20 25`) are **source pixels of this 809×240 file** —
the right slice has to cover the bite, which starts at x=736. The border widths
that go with them are in `em`, solved so the caps render at their true
proportion: `240k = 1.05 + 0.4 + 38k` → `k = 0.00718em` per source pixel. If you
re-cut this image, redo both.

There is deliberately **no background-colour** on the header: the bite is
transparent, and a colour behind it would fill the notch straight back in.

---

# Food photography

Cut out of the single contact sheet the owner supplied (ChatGPT-generated,
1536×1024, already on transparency). Each item was lifted with a connected-
component pass on the alpha channel, trimmed to its own pixels and stripped of
stray specks — `sides.png` in particular carried a 2×25px sliver that printed
as a hairline next to the chips.

Two of the items on that sheet are **deliberately not here**:

- **The Pepsi and Coca-Cola cans.** The generator mis-spelled both brand names
  ("pepc", and a garbled Coca-Cola script). A printed menu carrying a botched
  version of someone else's trademark is not something to send to press, so
  Drinks runs without a photo. A real can shot — or just the brands' own press
  images — would slot straight in.
- **A burger on its own.** The burger overlaps the nuggets and the cola in the
  source, so it can't be separated without a visible cut. The whole meal shot
  is used instead, above Meal Deals, which is where the designer put it too.
  That leaves Burgers without its own picture; one clean burger cutout is all
  it needs.

## Where they sit

Side photos are **absolutely positioned in the gutter between the item names
and the price column**, as the designer's sheets do — they are not in the flow.
That is deliberate: a photo in the flow narrows the list, which drags the
prices in from the right edge and leaves each section's prices at a different
margin. `--slot` reserves the photo's column on the list so a long item name wraps rather than running under
the picture, and `--rowmin` keeps the section at least as tall as its photo.

`check-collisions.mjs` measures the **ink**, not the boxes — the name's box
reaches under the photo by design while the glyphs don't. `render.mjs` runs the
same test before writing the PDF, so it cannot be forgotten.

## Resolution

**Generated, not typed.** `build-menu.mjs` computes each placement's dpi from
the PNG's own IHDR and the millimetres it is asked for, prints the table on
every build, and **throws below 140dpi** — this list went stale the moment the
photos were resized, and now it cannot.

| file | printed at | dpi |
|------|-----------|-----|
| shake | 36mm | 142 |
| sides | 57mm | 142 |
| cake | 50mm | 145 |
| burger-meal | 108mm | 149 |
| salad | 62mm | 153 |
| pizza | 82mm | 160 |
| kebab | 42mm | 181 |
| calzone | 46mm | 193 |
| wrap | 46mm | 197 |

The reference runs its photography larger than these files can carry, so the
sizes here are set by the resolution floor rather than by the reference. That
is the single biggest remaining gap to it, and only bigger originals close it.
