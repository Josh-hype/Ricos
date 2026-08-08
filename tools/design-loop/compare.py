#!/usr/bin/env python3
"""Measure a render against the reference visual, and build the side-by-side.

    python3 tools/design-loop/compare.py <reference.png> <render.png> <outdir>

Two outputs:
  <outdir>/side-by-side.png   reference left, render right, matched width
  stdout                      JSON of objective numbers

Why numbers at all, when agents can look at the pictures? Because "the yellow is
a bit off" and "the hero is too tall" are the two things a language model says
about every design, whether or not they are true, and neither survives being
asked "by how much". These measures are gain-and-crop tolerant and answer that:

  palette      the reference's dominant colours, and the nearest colour the
               render actually uses. A brand colour that is simply absent shows
               up as a large distance, not as an opinion.
  bands        horizontal section boundaries (strong row-to-row luminance
               steps) as a FRACTION of total height, for each image. Comparing
               fractions rather than pixels means a taller render is not
               reported as "every section is wrong".
  height_ratio render height / reference height at matched width. ~1.0 means the
               page has the proportions the design implies.

None of this is a pass/fail gate — a design visual is not a pixel target, and
treating it as one produces a page that matches the picture and breaks on a real
phone. It is here so the critics argue about measured differences instead of
remembered ones.
"""
import json
import pathlib
import sys

import cv2
import numpy as np
from PIL import Image

if len(sys.argv) != 4:
    sys.exit(__doc__)
ref_p, ren_p, out_d = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
for p in (ref_p, ren_p):
    if not p.exists():
        sys.exit(f'compare: missing {p}')
out_d.mkdir(parents=True, exist_ok=True)

W = 1000  # common width everything is measured at


def load(p):
    im = Image.open(p).convert('RGB')
    h = max(1, round(im.height * W / im.width))
    return np.array(im.resize((W, h), Image.LANCZOS))


ref, ren = load(ref_p), load(ren_p)


def palette(a, k=6):
    """Dominant colours by k-means. Ignores near-white/near-black, which are
    every page's background and text and so tell you nothing about a brand."""
    px = a.reshape(-1, 3).astype(np.float32)
    lum = px.mean(axis=1)
    px = px[(lum > 28) & (lum < 240)]
    if len(px) < k:
        return []
    px = px[np.random.default_rng(0).choice(len(px), min(60000, len(px)), replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, lab, cen = cv2.kmeans(px, k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lab.ravel(), minlength=k) / len(lab)
    order = np.argsort(-share)
    return [{'rgb': [int(v) for v in cen[i]], 'hex': '#%02x%02x%02x' % tuple(int(v) for v in cen[i]),
             'share': round(float(share[i]), 3)} for i in order]


def bands(a, n=12):
    """Section boundaries: the n strongest steps in the row-mean luminance,
    as fractions of height. Kept sparse and sorted so two lists are comparable
    by eye as well as by number."""
    prof = cv2.GaussianBlur(a.mean(axis=2).mean(axis=1).astype(np.float32), (1, 9), 0).ravel()
    d = np.abs(np.diff(prof))
    if not len(d):
        return []
    idx = np.argsort(-d)[:n * 4]
    keep = []
    for i in sorted(idx):                     # suppress neighbours of the same edge
        if all(abs(i - j) > len(prof) * 0.02 for j in keep):
            keep.append(int(i))
    keep = sorted(keep, key=lambda i: -d[i])[:n]
    return sorted(round(i / len(prof), 3) for i in keep)


def nearest(c, pal):
    if not pal:
        return None
    d = [(sum((a - b) ** 2 for a, b in zip(c['rgb'], q['rgb'])) ** 0.5, q) for q in pal]
    dist, q = min(d, key=lambda t: t[0])
    return {'hex': q['hex'], 'distance': round(float(dist), 1)}


ref_pal, ren_pal = palette(ref), palette(ren)
report = {
    'reference': {'file': str(ref_p), 'size': [int(ref_p.stat().st_size)], 'height_at_1000w': ref.shape[0]},
    'render': {'file': str(ren_p), 'height_at_1000w': ren.shape[0]},
    'height_ratio': round(ren.shape[0] / ref.shape[0], 3),
    'palette': [{**c, 'nearest_in_render': nearest(c, ren_pal)} for c in ref_pal],
    'palette_render_only': [c for c in ren_pal if (nearest(c, ref_pal) or {'distance': 999})['distance'] > 60],
    'bands': {'reference': bands(ref), 'render': bands(ren)},
}

# Side by side at a common height so the eye compares like with like.
h = max(ref.shape[0], ren.shape[0])
canvas = np.full((h + 40, W * 2 + 30, 3), 245, np.uint8)
canvas[40:40 + ref.shape[0], 0:W] = ref
canvas[40:40 + ren.shape[0], W + 30:W * 2 + 30] = ren
for x, label in ((10, 'REFERENCE'), (W + 40, 'CURRENT BUILD')):
    cv2.putText(canvas, label, (x, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2, cv2.LINE_AA)

# JPEG, not PNG, and both panels also written on their own. A full-page
# screenshot at 2x is 6MB; five critics each reading that per round is a lot of
# nothing, because none of the judgements here turn on the second pixel. The
# 2x originals stay on disk for anyone who needs to zoom.
side = out_d / 'side-by-side.jpg'
Image.fromarray(canvas).save(side, quality=88, optimize=True)
Image.fromarray(ref).save(out_d / 'reference-1000.jpg', quality=88, optimize=True)
Image.fromarray(ren).save(out_d / 'render-1000.jpg', quality=88, optimize=True)
report['side_by_side'] = str(side)
report['review_images'] = [str(out_d / 'reference-1000.jpg'), str(out_d / 'render-1000.jpg')]

print(json.dumps(report, indent=1))
