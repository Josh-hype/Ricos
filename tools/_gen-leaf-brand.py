#!/usr/bin/env python3
"""Build Leaf's brand assets from the shop's real logo artwork.

Run:  python3 tools/_gen-leaf-brand.py

Input:  data/shops/leaf-cafe/_source/logo-master.png  (owner-supplied, 2170x725 RGBA,
        gold wordmark on transparency — "THE LEAF / CAFÉ & BISTRO")

Output: data/shops/leaf-cafe/logo.png          header, footer, receipt emails
        data/shops/leaf-cafe/icon.png          favicon, /favicon.ico, staff app
        data/shops/leaf-cafe/assets/og-image.jpg  WhatsApp/Facebook share card

The favicon is the interesting one. A wordmark shrunk to 32px is an illegible
smear, so the icon is the LEAF GLYPH alone — the little leaf drawn inside the A
of LEAF. It can be lifted cleanly because the artwork is gold-on-transparency:
the leaf is separated from the A's strokes by transparent pixels, so it is its
own connected component in the alpha channel and no rectangular crop (which
would drag in the A's diagonals) is needed.
"""
from collections import deque
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOP = os.path.join(ROOT, 'data', 'shops', 'leaf-cafe')
SRC = os.path.join(SHOP, '_source', 'logo-master.png')

GREEN = '#153B31'   # theme.primary — the ground the logo sits on
ALPHA_ON = 100      # a pixel counts as artwork above this alpha


def report(path, img):
    kb = os.path.getsize(path) / 1024
    print(f'{kb:8.1f} KB  {os.path.relpath(path, ROOT)}  {img.size}')


def largest_component(img, box):
    """The biggest blob of artwork inside `box`, as its own trimmed RGBA image.

    Flood-fills the alpha mask rather than cropping a rectangle, so the leaf
    comes away from the A without bringing any of the letter with it.
    """
    x0, y0, x1, y1 = box
    crop = img.crop(box)
    w, h = crop.size
    a = crop.getchannel('A').load()
    on = [[a[x, y] > ALPHA_ON for y in range(h)] for x in range(w)]
    seen = [[False] * h for _ in range(w)]
    best = []
    for sx in range(w):
        for sy in range(h):
            if not on[sx][sy] or seen[sx][sy]:
                continue
            q, pts = deque([(sx, sy)]), []
            seen[sx][sy] = True
            while q:
                x, y = q.popleft()
                pts.append((x, y))
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and on[nx][ny] and not seen[nx][ny]:
                        seen[nx][ny] = True
                        q.append((nx, ny))
            if len(pts) > len(best):
                best = pts
    out = Image.new('RGBA', crop.size, (0, 0, 0, 0))
    src, dst = crop.load(), out.load()
    for x, y in best:
        dst[x, y] = src[x, y]
    return out.crop(out.getbbox())


def main():
    src = Image.open(SRC).convert('RGBA')
    art = src.crop(src.getbbox())          # drop the empty margin
    print(f'source {src.size} -> trimmed {art.size}')

    # ---- 1. logo.png : the wordmark, sized for the header ------------------
    W = 1000
    logo = art.resize((W, round(W * art.height / art.width)), Image.LANCZOS)
    p = os.path.join(SHOP, 'logo.png')
    logo.save(p, optimize=True)
    report(p, logo)

    # ---- 2. icon.png : the leaf alone, on the brand green ------------------
    # Search window around the A of LEAF; the leaf is the largest blob in it.
    leaf = largest_component(src, (1580, 230, 1850, 420))
    print(f'leaf glyph isolated: {leaf.size}')

    S = 512
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(icon).rounded_rectangle([0, 0, S - 1, S - 1], radius=96, fill=GREEN)
    lw = round(S * 0.66)                   # leaf fills two-thirds of the tile
    lh = round(lw * leaf.height / leaf.width)
    icon.alpha_composite(leaf.resize((lw, lh), Image.LANCZOS), ((S - lw) // 2, (S - lh) // 2))
    p = os.path.join(SHOP, 'icon.png')
    icon.save(p, optimize=True)
    report(p, icon)

    # ---- 3. hero.jpg / hero.webp : the landing page background -------------
    # The owner's file is a ~1.9MB PNG. That is fine as a master but far too
    # heavy to ship as a page background, so it stays in _source/ (never copied
    # to public/) and the two formats the page actually serves are derived here
    # — webp first via <source>, jpg as the fallback.
    # hero-background.png is the landscape shot the desktop band uses; hero-mob
    # is the portrait one, because at phone widths the hero box is taller than
    # it is wide TWICE OVER (1:1.93 to 1:2.34), and cover on the landscape
    # original was a heavy centre crop.
    for src_name, out_stem in (('hero-background.png', 'hero'), ('hero-mob.png', 'hero-mobile')):
        hero_src = os.path.join(SHOP, '_source', src_name)
        if not os.path.exists(hero_src):
            continue
        shot = Image.open(hero_src).convert('RGB')
        if out_stem == 'hero-mobile':
            # Trim hard under the plate. Cropping the BOTTOM pushes the plate DOWN the
            # frame proportionally, which is what keeps it clear of the stacked
            # buttons above it; it also drops the dead marble. Tuned against the measured
            # gap between the buttons and the plate, not by eye.
            shot = shot.crop((0, 0, shot.width, round(shot.height * 0.84)))
        for ext, kw in (('jpg', dict(quality=84, progressive=True)),
                        ('webp', dict(quality=80, method=6))):
            p = os.path.join(SHOP, 'assets', out_stem + '.' + ext)
            shot.save(p, optimize=True, **kw)
            report(p, shot)

    # ---- 4. og-image.jpg : the share card ----------------------------------
    # Rebuilt because the handoff's card carried the OLD wordmark (no "The").
    OW, OH = 1200, 630
    hero = os.path.join(SHOP, 'assets', 'hero.jpg')
    if os.path.exists(hero):
        photo = Image.open(hero).convert('RGB')
        scale = max(OW / photo.width, OH / photo.height)
        photo = photo.resize((round(photo.width * scale), round(photo.height * scale)), Image.LANCZOS)
        left = (photo.width - OW) // 2
        top = round((photo.height - OH) * 0.42)
        card = photo.crop((left, top, left + OW, top + OH)).convert('RGBA')
        # Green wash so the gold wordmark has something to sit on at thumbnail size.
        card.alpha_composite(Image.new('RGBA', (OW, OH), (21, 59, 49, 205)))
    else:
        # The interior photographs were pulled to be reshot, so there is nothing
        # to build the card on. Fall back to the brand ground — the same green
        # the page's placeholder panels use — rather than shipping a share card
        # of a photo the shop no longer uses. Drop a new assets/hero.jpg in and
        # re-run: the photo branch above takes over again on its own.
        print('no assets/hero.jpg — building the share card on the brand ground')
        card = Image.new('RGBA', (OW, OH), (0, 0, 0, 0))
        draw = ImageDraw.Draw(card)
        TOP, BOTTOM = (21, 59, 49), (12, 33, 27)   # --green -> --green-deep
        for y in range(OH):
            t = y / (OH - 1)
            draw.line([(0, y), (OW, y)],
                      fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    mw = round(OW * 0.62)
    mark = art.resize((mw, round(mw * art.height / art.width)), Image.LANCZOS)
    card.alpha_composite(mark, ((OW - mw) // 2, (OH - mark.height) // 2))
    p = os.path.join(SHOP, 'assets', 'og-image.jpg')
    card.convert('RGB').save(p, quality=88, optimize=True, progressive=True)
    report(p, card)


if __name__ == '__main__':
    main()
