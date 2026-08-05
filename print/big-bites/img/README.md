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

## Resolution

Print wants 300dpi. These are what the source allows:

| file | pixels | printed at | dpi |
|------|--------|-----------|-----|
| burger-meal | 635×366 | 62mm | 260 |
| pizza | 516×282 | 50mm | 262 |
| salad | 373×246 | 40mm | 237 |
| wrap | 356×230 | 38mm | 238 |
| calzone | 349×217 | 40mm | 222 |
| sides | 318×312 | 36mm | 224 |
| kebab | 300×212 | 34mm | 224 |
| cake | 285×204 | 36mm | 201 |
| shake | 201×301 | 26mm | 196 |

220–260dpi is fine for a takeaway menu on uncoated stock and none of them are
scaled past their own pixels, but they are **not** 300dpi — don't enlarge them
further. If the shop ever wants a glossy run, reshoot or regenerate at
1500px+ per item and the sizes above can grow.
