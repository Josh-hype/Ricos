#!/usr/bin/env python3
"""Prove that qr.svg encodes the host the sheet prints.

    python3 print/big-bites/verify-qr.py

The build can only compare two strings it was told (QR_TARGET against
config.business.domain) — it cannot read the committed SVG, because it is
pure Node built-ins by design. This re-encodes the URL with segno and
compares the module matrix against the SVG's own geometry, so a qr.svg that
was never regenerated after a domain change fails here.

Exits non-zero on any mismatch. Run it whenever the domain changes, and
before sending the sheet to press.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent

cfg = json.loads((ROOT / 'data/shops/food-station/config.json').read_text())
domain = cfg['business']['domain']
url = f'https://{domain}'

src = (HERE / 'build-menu.mjs').read_text()
m = re.search(r"const QR_TARGET = '([^']+)'", src)
if not m:
    sys.exit('could not find QR_TARGET in build-menu.mjs')
target = m.group(1)

print(f'config domain : {domain}')
print(f'QR_TARGET     : {target}')
if target != url:
    sys.exit(f'FAIL: QR_TARGET is {target} but config says {url}')

try:
    import segno
except ImportError:
    sys.exit('FAIL: segno is not installed, so the SVG cannot be verified.\n'
             '      pip install segno   (then re-run)')

# Re-encode, then rebuild the committed SVG's module grid and compare it
# cell by cell. Counting runs is not enough — two different payloads can
# produce the same number of runs.
svg = (HERE / 'qr.svg').read_text()
want = [list(row) for row in segno.make(url, error='H').matrix]
size = len(want)

# The QR modules are the stroked path; the other path is the white ground.
stroke = [d for tag, d in re.findall(r'<path([^>]*?)d="([^"]+)"', svg) if 'stroke' in tag]
if len(stroke) != 1:
    sys.exit(f'FAIL: expected exactly one stroked path in qr.svg, found {len(stroke)}')
d = stroke[0]

# segno emits absolute/relative moves plus horizontal runs, one run per span
# of dark modules, with y on the half-module so the stroke centres on the row.
got = [[0] * size for _ in range(size)]
x = y = 0.0
for cmd, args in re.findall(r'([MmhHvVzZ])\s*([-\d.\s]*)', d):
    nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', args)]
    if cmd == 'M':
        x, y = nums[0], nums[1]
    elif cmd == 'm':
        x, y = x + nums[0], y + nums[1]
    elif cmd in 'hH':
        for n in nums:
            run = n if cmd == 'h' else n - x
            col, row = int(round(x)), int(round(y - 0.5))
            for c in range(col, col + int(round(run))):
                # strip the 2-module quiet zone segno adds
                if 0 <= row - 2 < size and 0 <= c - 2 < size:
                    got[row - 2][c - 2] = 1
            x += run

diff = sum(1 for r in range(size) for c in range(size) if bool(got[r][c]) != bool(want[r][c]))
dark = sum(sum(r) for r in got)
print(f'matrix        : {size}x{size} modules, {dark} dark in svg')

if diff:
    sys.exit(f'FAIL: qr.svg differs from an encoding of {url} in {diff} of '
             f'{size * size} modules — it points somewhere else. Regenerate it.')

print(f'OK: qr.svg encodes exactly {url}')
