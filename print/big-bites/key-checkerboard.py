#!/usr/bin/env python3
"""Cut a cutout out of an image that has the transparency checkerboard baked in.

    python3 print/big-bites/key-checkerboard.py img/pepsi-coke.jpg img/pepsi-coke.png

Stock cutouts are often served as JPEG, which cannot carry an alpha channel, so
the checkerboard the preview drew becomes real pixels. On the black panel that
prints as a grey chequered rectangle, so it has to come off.

Every earlier attempt at this file damaged it, and always the same way: by
asking "is this pixel light and neutral?". That describes the checkerboard, and
it equally describes the top of an aluminium can, the white Coca-Cola script,
the silver rim at a can's foot and the white band down the Coke can's edge. One
attempt cut both can tops flat. The next left a dashed black gash down the side
of the Coke can — the white band keyed out inside the white squares and stayed
inside the grey ones.

So this does not test colour at all. **It tests alternation.** A cell of real
backdrop is 15% brighter or darker than the cells around it, because that is
what a checkerboard is. A white can edge, a silver rim and a white script are
all continuous — flat against their neighbours — no matter how closely their
colour matches the square they happen to sit on. The test is the ratio of a
cell's mean to its neighbours', against the ratio the two backdrop tones have.

That also settles the shadow the cans cast on the backdrop, which is neither
foreground nor a clean match for either tone: it dims the checkerboard without
erasing it, so the alternation survives and the shadow reads as background —
which is what it is. Its dimming is measured on the cells that are confidently
backdrop and interpolated across the rest, so the per-pixel test can be run
against a backdrop that is correctly darkened rather than against a flat one.

The rest is structural, never colour:
  - bridge across cells, which re-joins anything the pattern test dashed
  - keep the largest connected region, dropping the stock site's "PNG"
    watermark badge without knowing anything about it
  - fill interior holes
  - erode a pixel, taking off the white fringe JPEG leaves at the edge, which
    would otherwise print as a halo on black

It reports the silhouette's top and right edge across the frame: a can that has
been cut flat or bitten into shows up as a straight run in those numbers.
"""
import pathlib
import sys

import cv2
import numpy as np
from PIL import Image

if len(sys.argv) != 3:
    sys.exit(__doc__)
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

rgb = np.array(Image.open(src).convert('RGB')).astype(np.float32)
h, w = rgb.shape[:2]
lum = rgb.mean(axis=2)

# --- measure the grid off the top edge rather than assuming a cell size -----
row = rgb[0, :, 0]
edges = [x for x in range(1, w) if abs(float(row[x]) - float(row[x - 1])) > 12]
if len(edges) < 3:
    sys.exit('FAIL: no checkerboard found along the top edge')
cell = int(np.median(np.diff(edges[:12])))
if not 4 <= cell <= 64:
    sys.exit(f'FAIL: implausible checker cell of {cell}px')
phase = edges[0] % cell

ys, xs = np.mgrid[0:h, 0:w]
square = ((xs - phase) // cell + (ys - phase) // cell) % 2
corner, csq = rgb[:cell * 4, :cell * 4], square[:cell * 4, :cell * 4]
tone = np.array([np.median(corner[csq == k].reshape(-1, 3), axis=0) for k in (0, 1)])
tlum = tone.mean(axis=1)
print(f'checker: {cell}px cells, phase {phase}, tones '
      f'{tone[0].astype(int).tolist()} / {tone[1].astype(int).tolist()}')

# --- per-cell statistics ---------------------------------------------------
ch, cw = (h - phase) // cell, (w - phase) // cell
blk = lum[phase:phase + ch * cell, phase:phase + cw * cell].reshape(ch, cell, cw, cell)
cmean = blk.mean(axis=(1, 3))
cstd = blk.std(axis=(1, 3))
sat = (rgb.max(axis=2) - rgb.min(axis=2))[phase:phase + ch * cell,
                                          phase:phase + cw * cell].reshape(ch, cell, cw, cell)
csat = sat.mean(axis=(1, 3))

cys, cxs = np.mgrid[0:ch, 0:cw]
parity = ((cxs + cys) % 2)                       # 0 -> the lighter tone

# How strongly does the picture here follow the checkerboard? Correlation, not
# a difference: it is invariant to both gain and offset, so the cans' shadow —
# which dims the backdrop and washes its contrast out to a third — still reads
# as a perfect match, while a flat white can edge reads as no match at all
# however closely its colour happens to sit on the tone of the square beneath.
P = np.where(square == 0, 1.0, -1.0).astype(np.float32)


def checker_corr(n):
    win = (n, n)
    mA, mP = cv2.blur(lum, win), cv2.blur(P, win)
    vA = cv2.blur(lum * lum, win) - mA * mA
    vP = cv2.blur(P * P, win) - mP * mP
    cov = cv2.blur(lum * P, win) - mA * mP
    return cov / np.sqrt(np.maximum(vA, 1e-6) * np.maximum(vP, 1e-6))


corr = checker_corr(cell * 3)
# The same measure at a tighter window decides the last few pixels at the
# silhouette. A wide window cannot: centred a few pixels outside the can it
# sees as much can as backdrop, and so does one centred on the can's white
# edge — the two look alike at that scale, which left a chequered halo hugging
# the cans. At a window and a half the backdrop still alternates and the flat
# edge still does not.
corr_fine = checker_corr(int(cell * 1.5) | 1)
ccorr = corr[phase:phase + ch * cell, phase:phase + cw * cell].reshape(ch, cell, cw, cell) \
            .mean(axis=(1, 3))
bgcell = (ccorr > 0.55) & (cstd < 14) & (csat < 14)

n, lab = cv2.connectedComponents(bgcell.astype(np.uint8), 4)
border = (set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])) - {0}
if not border:
    sys.exit('FAIL: no backdrop reaches the border — is this really a checkerboard?')
outside = np.isin(lab, list(border))
print(f'backdrop: {outside.sum()} of {ch * cw} cells alternate correctly and reach the edge')

# --- how much the shadow dims the backdrop, measured then interpolated -----
known = (cmean / np.where(parity == 0, tlum[0], tlum[1])).astype(np.float32)
num = np.where(outside, known, 0).astype(np.float32)
den = outside.astype(np.float32)
for _ in range(48):        # normalised convolution: spread the measured dimming
    num, den = cv2.blur(num, (5, 5)), cv2.blur(den, (5, 5))
    num[outside], den[outside] = known[outside], 1.0
scale = np.clip(num / np.maximum(den, 1e-6), 0.4, 1.05)
print(f'backdrop dimming: {scale.min():.2f}-{scale.max():.2f} of full brightness')
sfield = cv2.resize(scale, (w, h), interpolation=cv2.INTER_LINEAR)

expect = np.where(square[..., None] == 0, tone[0], tone[1]) * sfield[..., None]
match = (np.abs(rgb - expect).max(axis=2) <= 14)

protected = np.kron(outside, np.ones((cell, cell), bool))
protected = np.pad(protected, ((phase, h - phase - protected.shape[0]),
                               (phase, w - phase - protected.shape[1])))
protected = (protected | (corr_fine > 0.5)) & match

# --- bridge the dashes a continuous white edge leaves ----------------------
fg0 = (~match).astype(np.uint8)
span = cell * 2 + 1
# Pad with background first. cv2's erode treats out-of-frame as the MAXIMUM
# value, so the erode half of a closing sees solid foreground just outside the
# frame and fills a band of real backdrop all the way round the edge — which is
# exactly the ragged checkerboard fringe this left along the bottom.
pad = np.zeros((h + 2 * span, w + 2 * span), np.uint8)
pad[span:span + h, span:span + w] = fg0
closed = cv2.morphologyEx(pad, cv2.MORPH_CLOSE, np.ones((span, 1), np.uint8)) \
       | cv2.morphologyEx(pad, cv2.MORPH_CLOSE, np.ones((1, span), np.uint8))
bridged = closed[span:span + h, span:span + w]
fg = (bridged & ~protected).astype(np.uint8)
print(f'bridged {int(fg.sum() - fg0.sum())}px the pattern test alone had dashed out')

# --- structural clean-up ---------------------------------------------------
k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k3)
n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
if n < 2:
    sys.exit('FAIL: nothing survived the key')
keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
others = sorted(stats[1:, cv2.CC_STAT_AREA].tolist(), reverse=True)[1:]
fg = (lab == keep).astype(np.uint8)
print(f'kept the largest of {n - 1} regions ({stats[keep, cv2.CC_STAT_AREA]}px)'
      + (f', dropped {len(others)} smaller (largest {others[0]}px)' if others else ''))

inv = (1 - fg).astype(np.uint8)                  # fill interior holes
cv2.floodFill(inv, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 2)
fg[inv == 1] = 1

# Three pixels, not one: JPEG leaves a light fringe at the edge, and the
# backdrop's own last pixel or two is antialiased into the subject and cannot
# be classified either way. At 34mm on the sheet three pixels is 0.13mm, so
# the silhouette loses nothing visible and the halo goes.
fg = cv2.erode(fg, k3, iterations=3)             # JPEG's white fringe
alpha = cv2.GaussianBlur(fg * 255, (3, 3), 0)
Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha.astype(np.uint8)]), 'RGBA').save(dst)

# --- report the silhouette so a cut-off or bitten can cannot pass ----------
solid = alpha > 128
ys_, xs_ = np.nonzero(solid)
print(f'{dst.name}: {w}x{h}, ink {xs_.max() - xs_.min() + 1}x{ys_.max() - ys_.min() + 1}'
      f' at ({xs_.min()},{ys_.min()})')
for label, axis in (('top edge, left to right', 0), ('right edge, top to bottom', 1)):
    lo, hi = (xs_.min(), xs_.max()) if axis == 0 else (ys_.min(), ys_.max())
    step = max(1, (hi - lo) // 24)
    runs = [np.nonzero(solid[:, i] if axis == 0 else solid[i, :])[0] for i in range(lo, hi + 1, step)]
    vals = [(str(r.min()) if axis == 0 else str(r.max())) if len(r) else '—' for r in runs]
    print(f'  {label}: ' + ' '.join(vals))

# --- the gate: put the cutout back on the checkerboard it came off ---------
# Composited over a synthetic backdrop this must reproduce the source. Anything
# cut out of a can shows up here as a difference, and so does retained
# backdrop. Eyeballing a composite on black is what let a dashed gash down the
# Coke can ship twice — it reads as an edge unless you know the can's edge is
# white. This does not need to be recognised, only measured.
a = (alpha / 255.0)[..., None]
recon = rgb * a + np.where(square[..., None] == 0, tone[0], tone[1]) * (1 - a)
d = np.abs(recon - rgb * 0 - np.array(Image.open(src).convert('RGB'), np.float32)).max(axis=2)
bad = int((d > 60).sum())
print(f'against the source: {int((d > 30).sum())}px differ by >30/255, {bad} by >60 '
      f'({100 * bad / d.size:.2f}% of the frame)')
# 0.3%, and the figure is calibrated rather than picked: reproducing the two
# defects this file actually shipped scores 6.02% for the flat-cut can tops and
# 0.77% for the gash down the Coke can, against 0.03% for a clean key. A 1%
# threshold — the obvious round number — would have passed the gash.
if bad > d.size * 0.003:
    sys.exit('FAIL: the key does not reproduce the source — it has cut into the subject '
             'or kept backdrop. Nothing was written you should trust.')
