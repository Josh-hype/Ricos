#!/usr/bin/env python3
"""Trim the fully transparent border off a cutout PNG.

    python3 print/big-bites/trim-alpha.py img/parmasan.png [...]

This removes NO food. It removes canvas that has nothing on it — every pixel
it drops is alpha <= 16, and the script asserts that before writing and checks
the opaque pixel count is identical afterwards. Run it once on a newly
uploaded cutout; it is idempotent.

Why it matters: the generator sizes a photo by its *canvas* width, because
`build-menu.mjs` is pure Node built-ins and cannot decode a PNG beyond its
header. Two of the owner's uploads were 1024x1536 canvases carrying a 1000x576
picture sitting at the bottom — placed as-is, 62% of the reserved height would
have been empty, the food would have printed at a third of the size the space
implied, and on the inner middle panel (five sections, the tightest on the
sheet) that wasted height is the difference between a photo fitting its
section and overrunning it.

It also fixes the dpi report, which divides the canvas width by the placed
width and so reads high whenever the canvas is padded.
"""
import pathlib
import sys

import numpy as np
from PIL import Image

CUT = 16  # alpha at or below this is "nothing there"

if len(sys.argv) < 2:
    sys.exit(__doc__)

for arg in sys.argv[1:]:
    p = pathlib.Path(arg)
    im = Image.open(p)
    if im.mode != 'RGBA':
        print(f'{p.name}: not RGBA ({im.mode}) — nothing to trim')
        continue

    a = np.array(im)
    alpha = a[..., 3]
    ys, xs = np.nonzero(alpha > CUT)
    if not len(xs):
        sys.exit(f'{p.name}: the whole image is transparent')
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())

    if (x0, y0) == (0, 0) and (x1, y1) == (im.width - 1, im.height - 1):
        print(f'{p.name}: already tight ({im.width}x{im.height})')
        continue

    # Prove the discarded border holds nothing before discarding it.
    keep = np.zeros(alpha.shape, bool)
    keep[y0:y1 + 1, x0:x1 + 1] = True
    if (alpha[~keep] > CUT).any():
        sys.exit(f'{p.name}: refusing to trim — the border is not empty')

    before = int((alpha > CUT).sum())
    out = im.crop((x0, y0, x1 + 1, y1 + 1))
    after = int((np.array(out)[..., 3] > CUT).sum())
    if before != after:
        sys.exit(f'{p.name}: trim lost {before - after} opaque pixels — aborted')

    out.save(p)
    print(f'{p.name}: {im.width}x{im.height} -> {out.width}x{out.height} '
          f'(border only, {before} opaque pixels unchanged)')
