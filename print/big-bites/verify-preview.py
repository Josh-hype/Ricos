#!/usr/bin/env python3
"""Prove preview.png actually shows what the PDF contains.

    python3 print/big-bites/verify-preview.py [pdf]

The preview is the only thing anyone reviews. It is rendered from the same
page, but by a DIFFERENT code path — screen media, its own browser context —
and the two do diverge. They diverged silently once already: an absolutely
positioned element pushed below the page box (`bottom: -4mm`) renders fine on
screen and is DROPPED ENTIRELY by Chromium's print path, so the cover's pizza
photograph was in the preview and absent from the PDF. Every other gate passed,
because every other gate reads the PDF or the DOM, and neither of those
disagreed with itself.

A global mean is useless here — one missing photograph barely moves it. This
compares a grid of blocks, which is what makes a localised difference show up.

Exits non-zero if any block diverges. Run after render.mjs; render.mjs runs it.
"""
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
PDF = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'big-bites-menu-A3-trifold.pdf'
PREVIEW = HERE / 'preview.png'

GRID = 24          # blocks across each page
TOL = 26.0         # per-block mean-luminance difference, 0-255
MAX_BAD = 2        # a couple of blocks may differ on antialiasing alone

if not PDF.exists():
    sys.exit(f'FAIL: {PDF.name} not found')
if not PREVIEW.exists():
    sys.exit('FAIL: preview.png not found')

with tempfile.TemporaryDirectory() as td:
    subprocess.run(['pdftoppm', '-r', '50', '-png', str(PDF), f'{td}/p'],
                   check=True, capture_output=True)
    pages = sorted(pathlib.Path(td).glob('p-*.png'))
    if len(pages) != 2:
        sys.exit(f'FAIL: expected 2 PDF pages, rasterised {len(pages)}')

    prev = Image.open(PREVIEW).convert('L')
    ph = prev.size[1] // 2
    halves = [prev.crop((0, 0, prev.size[0], ph)),
              prev.crop((0, ph, prev.size[0], prev.size[1]))]

    worst = 0.0
    bad = []
    for i, (pg, half) in enumerate(zip(pages, halves), start=1):
        a = Image.open(pg).convert('L').resize((GRID * 8, GRID * 8), Image.BOX)
        b = half.resize((GRID * 8, GRID * 8), Image.BOX)
        A = np.array(a, float).reshape(GRID, 8, GRID, 8).mean(axis=(1, 3))
        B = np.array(b, float).reshape(GRID, 8, GRID, 8).mean(axis=(1, 3))
        d = np.abs(A - B)
        worst = max(worst, d.max())
        for (r, c) in zip(*np.nonzero(d > TOL)):
            bad.append(f'page {i} block r{r} c{c}: PDF {A[r, c]:.0f} vs preview {B[r, c]:.0f}'
                       f' (delta {d[r, c]:.0f})')

print(f'preview vs PDF: worst block delta {worst:.1f}/255 (tolerance {TOL:.0f}, {len(bad)} over)')
if len(bad) > MAX_BAD:
    print('FAIL: preview.png does not match the PDF — one of them is missing content.',
          file=sys.stderr)
    for line in bad[:10]:
        print('  ' + line, file=sys.stderr)
    sys.exit(1)
print('OK: preview.png matches the PDF')
