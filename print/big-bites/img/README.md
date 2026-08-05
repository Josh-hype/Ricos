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
margin. `--gutter` reserves the space on the leaders (or on the name, for lists
that hide their leaders) so a long item name wraps rather than running under
the picture, and `--rowmin` keeps the section at least as tall as its photo.

`scratchpad/collide.mjs` measures the **ink**, not the boxes — `.n` is `flex:1`
with the gutter as padding, so its box reaches under the photo by design while
the glyphs don't. Re-run it after resizing any photo.

## Resolution

Print wants 300dpi. These are what the source allows at the sizes actually used:

| file | pixels | printed at | dpi |
|------|--------|-----------|-----|
| kebab | 300×212 | 27mm | 282 |
| wrap | 356×230 | 33mm | 274 |
| pizza | 516×282 | 50mm | 262 |
| calzone | 349×217 | 34mm | 261 |
| salad | 373×246 | 40mm | 237 |
| sides | 318×312 | 36mm | 224 |
| cake | 285×204 | 36mm | 201 |
| shake | 201×301 | 26mm | 196 |
| **burger-meal** | 635×366 | **96mm** | **168** |

200–280dpi is fine for a takeaway menu on uncoated stock. **The burger hero is
not** — at 96mm it is running at 168dpi to fill the panel above Meal Deals, and
it is the one image on the sheet that will look visibly soft in print. It is
the largest source file there is, so the only fix is a bigger original: 1200px
wide would put it back over 300dpi at the same size.

Nothing here is scaled past its own pixels other than that hero. If the shop
ever wants a glossy run, regenerate at 1500px+ per item.
