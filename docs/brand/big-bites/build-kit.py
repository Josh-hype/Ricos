#!/usr/bin/env python3
"""Regenerate the Big Bites vector brand kit from the Luckiest Guy outlines.

    pip install fonttools uharfbuzz
    curl -o LuckiestGuy-Regular.ttf \
      https://fonts.gstatic.com/s/luckiestguy/v25/_gP_1RrxsjcxVyin9l9n_j2RSg.ttf
    BB_OUT=svg python3 build-kit.py

Glyphs are emitted as real outline geometry — no <text>, no font dependency,
no filters — so the files open identically in Illustrator, Inkscape, Affinity,
Canva, browsers and print RIPs. The one-colour variants are fully flattened
<path>s (cutter/embroidery friendly); the full-colour ones reuse each outline
via <use> so the 3D extrude can be swept smoothly without a huge file.

Proportions are measured off the approved raster lockup, not eyeballed — see
README.md. To add a new town lockup or offer tab, add a write() line in main().
"""
import math
import os
import re

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
TTF = os.path.join(HERE, 'LuckiestGuy-Regular.ttf')
OUT = os.environ.get('BB_OUT', os.path.join(HERE, 'svg'))

YELLOW = '#F7C61A'
RED = '#E32619'
DEEPRED = '#A81409'
CHAR = '#0C0C0C'
CREAM = '#FBF3DE'
OFFWHITE = '#FFFDF7'

font = TTFont(TTF)
UPM = font['head'].unitsPerEm          # 2048
CAP = font['OS/2'].sCapHeight          # 1424
cmap = font.getBestCmap()
glyphset = font.getGlyphSet()

_blob = hb.Blob.from_file_path(TTF)
_face = hb.Face(_blob)
_hbfont = hb.Font(_face)
_order = font.getGlyphOrder()


def _round_d(d, nd=1):
    """Trim path coordinates to `nd` decimals to keep the files tidy."""
    def fix(m):
        v = round(float(m.group(0)), nd)
        return ('%f' % v).rstrip('0').rstrip('.') or '0'
    return re.sub(r'-?\d+\.\d+', fix, d)


def glyph_d(gname):
    """Outline of one glyph, in font units, already flipped to SVG (y-down)."""
    pen = SVGPathPen(glyphset)
    glyphset[gname].draw(pen)
    d = pen.getCommands()
    if not d:
        return ''
    # y-up -> y-down happens in the caller's transform; keep raw here.
    return _round_d(d)


def shape(text, tracking=0.0):
    """HarfBuzz-shaped run. Returns (placements, advance_width) in font units.

    `tracking` is extra letter-spacing as a fraction of the em.
    """
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(_hbfont, buf)
    extra = tracking * UPM
    out, x = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        gname = _order[info.codepoint]
        out.append((gname, x + pos.x_offset, pos.y_offset))
        x += pos.x_advance + extra
    return out, max(0.0, x - extra)


def run_bbox(placements):
    """Tight ink bbox of a shaped run, in font units (y-up)."""
    glyf = font['glyf']
    x0 = y0 = 1e9
    x1 = y1 = -1e9
    for gname, dx, dy in placements:
        g = glyf[gname]
        if g.numberOfContours == 0:
            continue
        x0 = min(x0, g.xMin + dx)
        x1 = max(x1, g.xMax + dx)
        y0 = min(y0, g.yMin + dy)
        y1 = max(y1, g.yMax + dy)
    return x0, y0, x1, y1


def esc(t):
    """XML-escape user-facing strings (titles, aria-labels)."""
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;'))


def f(v, nd=2):
    s = ('%.*f' % (nd, v)).rstrip('0').rstrip('.')
    return s or '0'


# ---------------------------------------------------------------- wordmark ---

# Proportions measured off the approved raster lockup (logo.png, 914x652) by
# reading its pixel extents, not by eye — see docs in the kit README.
EXT_X = 0.128 * CAP          # 3D extrude offset, rightwards
EXT_Y = 0.143 * CAP          # 3D extrude offset, downwards
OUTLINE = 0.0246 * CAP       # dark keyline weight (35 font units)
STEPS = 32                   # copies swept along the extrude vector
SEAM = 0.006 * CAP           # hairline stroke that closes the sweep's stair-steps
LINEGAP = 1.312 * CAP        # baseline-to-baseline
TRACK = 0.024                # letter-spacing, fraction of em

LINES = ('BIG', 'BITES')


def wordmark_geometry(track=TRACK):
    """Lay the two lines out, centred, and return everything the drawing
    routines need in a single flat dict of font-unit coordinates."""
    runs = []
    for i, word in enumerate(LINES):
        pl, adv = shape(word, track)
        runs.append({'word': word, 'pl': pl, 'adv': adv, 'baseline': i * LINEGAP})
    width = max(r['adv'] for r in runs)
    for r in runs:
        r['x'] = (width - r['adv']) / 2.0
    return runs, width


def glyph_use(runs, klass=''):
    """Yield (d, tx, ty) for every glyph placement, in SVG (y-down) space
    where y=0 is the cap-top of the first line."""
    for r in runs:
        for gname, dx, dy in r['pl']:
            d = glyph_d(gname)
            if not d:
                continue
            yield d, r['x'] + dx, r['baseline'] + CAP - dy


def _paths(items, indent='    '):
    return '\n'.join('%s<path d="%s" transform="translate(%s %s) scale(1 -1)"/>'
                     % (indent, d, f(tx), f(ty)) for d, tx, ty in items)


class Defs:
    """Collects each distinct glyph outline once so the extrude can be swept
    with many <use> copies instead of many duplicated <path>s."""

    def __init__(self):
        self.ids = {}

    def id_for(self, d):
        if d not in self.ids:
            self.ids[d] = 'g%d' % len(self.ids)
        return self.ids[d]

    def render(self, indent='  '):
        return '\n'.join('%s<path id="%s" d="%s"/>' % (indent, i, d)
                         for d, i in self.ids.items())


def _uses(items, defs, indent='    '):
    return '\n'.join(
        '%s<use href="#%s" xlink:href="#%s" transform="translate(%s %s) scale(1 -1)"/>'
        % (indent, defs.id_for(d), defs.id_for(d), f(tx), f(ty))
        for d, tx, ty in items)


def build_wordmark(bite='charcoal', mono=None, track=TRACK):
    """bite: 'charcoal' | 'knockout' | 'none'.  mono: None or a colour."""
    runs, width = wordmark_geometry(track)
    ink = list(glyph_use(runs))

    # Frame: ink bbox of both lines + the extrude + the keyline + the bite.
    xs0 = min(r['x'] + run_bbox(r['pl'])[0] for r in runs)
    xs1 = max(r['x'] + run_bbox(r['pl'])[2] for r in runs)
    ytop = CAP - max(run_bbox(runs[0]['pl'])[3], 0)
    ybot = runs[-1]['baseline'] + CAP - run_bbox(runs[-1]['pl'])[1]

    # The bite: a big circle chomped out of the top-right of the last line,
    # plus the little detached crumb. Positioned off that line's top-right.
    lx0, ly0, lx1, ly1 = run_bbox(runs[-1]['pl'])
    last_top = runs[-1]['baseline'] + CAP - ly1
    right = runs[-1]['x'] + lx1
    big_r = 0.372 * CAP
    big_c = (right - 0.032 * CAP, last_top + 0.31 * CAP)
    dot_r = 0.062 * CAP
    dot_c = (big_c[0] + 0.101 * CAP, big_c[1] - 0.473 * CAP)
    bites = [(big_c, big_r), (dot_c, dot_r)]

    pad = OUTLINE + 2
    x0 = min(xs0, min(c[0] - r for c, r in bites)) - pad
    x1 = max(xs1 + EXT_X, max(c[0] + r for c, r in bites)) + pad
    y0 = min(ytop, min(c[1] - r for c, r in bites)) - pad
    y1 = max(ybot + EXT_Y, max(c[1] + r for c, r in bites)) + pad
    w, h = x1 - x0, y1 - y0

    # Swept extrude: STEPS copies along the offset vector. Filling *and*
    # stroking them in one colour makes a single solid silhouette with no
    # internal seams; the red body then sits inside it, so the dark shows
    # only as a keyline.
    sweep = []
    for i in range(STEPS + 1):
        t = i / float(STEPS)
        for d, tx, ty in ink:
            sweep.append((d, tx + t * EXT_X, ty + t * EXT_Y))

    defs = Defs()
    L = []
    if mono:
        # One-colour version: flat silhouette, no extrude, no keyline. Kept as
        # plain <path>s — this is the file a vinyl cutter or embroiderer gets.
        L.append('  <g fill="%s">' % mono)
        L.append(_paths(ink, '    '))
        L.append('  </g>')
    else:
        L.append('  <!-- 3D extrude: dark silhouette, then the red body inside it -->')
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (CHAR, CHAR, f(OUTLINE * 2)))
        L.append(_uses(sweep, defs, '    '))
        L.append('  </g>')
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (RED, RED, f(SEAM)))
        L.append(_uses(sweep, defs, '    '))
        L.append('  </g>')
        L.append('  <!-- faces: dark keyline, then the yellow face on top -->')
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (CHAR, CHAR, f(OUTLINE * 2)))
        L.append(_uses(ink, defs, '    '))
        L.append('  </g>')
        L.append('  <g fill="%s">' % YELLOW)
        L.append(_uses(ink, defs, '    '))
        L.append('  </g>')

    body = '\n'.join(L)
    bite_circles = '\n'.join(
        '    <circle cx="%s" cy="%s" r="%s"/>' % (f(c[0]), f(c[1]), f(r))
        for c, r in bites)

    head = ['<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 %s %s" '
            'width="%s" height="%s" role="img" aria-label="Big Bites">'
            % (f(w), f(h), f(w / 4.0), f(h / 4.0)),
            '<title>Big Bites</title>']
    if defs.ids:
        head += ['<defs>', defs.render(), '</defs>']

    if bite == 'knockout':
        # Mask lives on an inner group with no transform of its own, so its
        # userSpaceOnUse coordinates are unambiguously the artwork's own.
        head += ['<defs>',
                 '  <mask id="bb-bite" maskUnits="userSpaceOnUse" '
                 'x="%s" y="%s" width="%s" height="%s">' % (f(x0), f(y0), f(w), f(h)),
                 '    <rect x="%s" y="%s" width="%s" height="%s" fill="#fff"/>'
                 % (f(x0), f(y0), f(w), f(h)),
                 bite_circles.replace('<circle', '<circle fill="#000"'),
                 '  </mask>',
                 '</defs>']
        inner = '<g mask="url(#bb-bite)">\n%s\n</g>' % body
    else:
        if bite == 'charcoal':
            body += '\n  <!-- the bite -->\n  <g fill="%s">\n%s\n  </g>' % (
                mono or CHAR, bite_circles)
        inner = body

    return ('%s\n<g transform="translate(%s %s)">\n%s\n</g>\n</svg>\n'
            % ('\n'.join(head), f(-x0), f(-y0), inner))


# ------------------------------------------------------------ single-line ----

def build_single_line(text='BIG BITES', mono=None, bite='charcoal', track=TRACK):
    pl, adv = shape(text, track)
    ink = [(glyph_d(g), dx, CAP - dy) for g, dx, dy in pl if glyph_d(g)]
    bx0, by0, bx1, by1 = run_bbox(pl)
    big_r = 0.372 * CAP
    big_c = (bx1 - 0.032 * CAP, (CAP - by1) + 0.31 * CAP)
    dot_r = 0.062 * CAP
    dot_c = (big_c[0] + 0.101 * CAP, big_c[1] - 0.473 * CAP)
    bites = [(big_c, big_r), (dot_c, dot_r)] if bite != 'none' else []

    pad = OUTLINE + 2
    x0 = min([bx0] + [c[0] - r for c, r in bites]) - pad
    x1 = max([bx1 + EXT_X] + [c[0] + r for c, r in bites]) + pad
    y0 = min([CAP - by1] + [c[1] - r for c, r in bites]) - pad
    y1 = max([CAP - by0 + EXT_Y] + [c[1] + r for c, r in bites]) + pad
    w, h = x1 - x0, y1 - y0

    sweep = []
    for i in range(STEPS + 1):
        t = i / float(STEPS)
        for d, tx, ty in ink:
            sweep.append((d, tx + t * EXT_X, ty + t * EXT_Y))

    defs = Defs()
    L = []
    if mono:
        L.append('  <g fill="%s">' % mono)
        L.append(_paths(ink, '    '))
        L.append('  </g>')
    else:
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (CHAR, CHAR, f(OUTLINE * 2)))
        L.append(_uses(sweep, defs, '    '))
        L.append('  </g>')
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (RED, RED, f(SEAM)))
        L.append(_uses(sweep, defs, '    '))
        L.append('  </g>')
        L.append('  <g fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                 % (CHAR, CHAR, f(OUTLINE * 2)))
        L.append(_uses(ink, defs, '    '))
        L.append('  </g>')
        L.append('  <g fill="%s">' % YELLOW)
        L.append(_uses(ink, defs, '    '))
        L.append('  </g>')

    body = '\n'.join(L)
    circles = '\n'.join('    <circle cx="%s" cy="%s" r="%s"/>'
                        % (f(c[0]), f(c[1]), f(r)) for c, r in bites)
    maskdefs = ''
    if bite == 'knockout' and bites:
        maskdefs = ('  <mask id="bb-bite" maskUnits="userSpaceOnUse" x="%s" y="%s" '
                    'width="%s" height="%s">\n'
                    '    <rect x="%s" y="%s" width="%s" height="%s" fill="#fff"/>\n%s\n'
                    '  </mask>\n'
                    % (f(x0), f(y0), f(w), f(h), f(x0), f(y0), f(w), f(h),
                       circles.replace('<circle', '<circle fill="#000"')))
        body = '<g mask="url(#bb-bite)">\n%s\n</g>' % body
    elif bites:
        body += '\n  <g fill="%s">\n%s\n  </g>' % (mono or CHAR, circles)

    inner_defs = ('%s\n' % defs.render()) if defs.ids else ''
    head_defs = ('<defs>\n%s%s</defs>\n' % (inner_defs, maskdefs)
                 if (inner_defs or maskdefs) else '')

    return ('<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 %s %s" width="%s" '
            'height="%s" role="img" aria-label="%s">\n<title>%s</title>\n%s'
            '<g transform="translate(%s %s)">\n%s\n</g>\n</svg>\n'
            % (f(w), f(h), f(w / 4.0), f(h / 4.0), esc(text.title()),
               esc(text.title()), head_defs, f(-x0), f(-y0), body))


# ------------------------------------------------------------- bite mark -----

def build_bite_mark(fill=RED):
    """The signature chomp: a disc with a bite out of it, plus the crumb.

    Drawn in a local frame centred on the disc, then framed by translating so
    the artwork sits flush against the viewBox with a hair of padding.
    """
    R = 100.0
    br, bc = 46.0, (80.0, -68.0)          # the bite taken out, top-right
    dr, dc = 21.0, (130.0, -106.0)        # the detached crumb
    pad = 4.0
    lx0, ly0 = -R, min(-R, dc[1] - dr)
    lx1, ly1 = max(R, dc[0] + dr), R
    w, h = (lx1 - lx0) + 2 * pad, (ly1 - ly0) + 2 * pad
    ox, oy = -lx0 + pad, -ly0 + pad
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" '
            'height="%s" role="img" aria-label="Big Bites bite mark">\n'
            '<title>Bite mark</title>\n'
            '<defs>\n'
            '  <mask id="chomp" maskUnits="userSpaceOnUse" x="%s" y="%s" '
            'width="%s" height="%s">\n'
            '    <rect x="%s" y="%s" width="%s" height="%s" fill="#fff"/>\n'
            '    <circle cx="%s" cy="%s" r="%s" fill="#000"/>\n'
            '  </mask>\n'
            '</defs>\n'
            '<g transform="translate(%s %s)" fill="%s">\n'
            '  <circle cx="0" cy="0" r="%s" mask="url(#chomp)"/>\n'
            '  <circle cx="%s" cy="%s" r="%s"/>\n'
            '</g>\n</svg>\n'
            % (f(w), f(h), f(w), f(h),
               f(lx0 - pad), f(ly0 - pad), f(w), f(h),
               f(lx0 - pad), f(ly0 - pad), f(w), f(h),
               f(bc[0]), f(bc[1]), f(br),
               f(ox), f(oy), fill, f(R), f(dc[0]), f(dc[1]), f(dr)))


# -------------------------------------------------------------- app icon -----

def build_app_icon(bg=YELLOW, letter_fill=RED, letter_stroke=DEEPRED,
                   knockout=True, squircle=0.185):
    S = 1024.0
    r = squircle * S
    bite_c, bite_r = (868.0, 148.0), 168.0
    gname = cmap[ord('B')]
    d = glyph_d(gname)
    g = font['glyf'][gname]
    gw, gh = g.xMax - g.xMin, g.yMax - g.yMin
    target_h = 470.0
    s = target_h / gh
    tx = (S - gw * s) / 2.0 - g.xMin * s
    ty = (S - gh * s) / 2.0 + g.yMax * s
    sw = 26.0 / s
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            'width="1024" height="1024" role="img" aria-label="Big Bites">\n'
            '<title>Big Bites app icon</title>\n'
            '<defs>\n'
            '  <mask id="icon-bite" maskUnits="userSpaceOnUse" x="0" y="0" '
            'width="1024" height="1024">\n'
            '    <rect width="1024" height="1024" fill="#fff"/>\n'
            '    <circle cx="%s" cy="%s" r="%s" fill="#000"/>\n'
            '  </mask>\n'
            '</defs>\n'
            '<rect x="0" y="0" width="1024" height="1024" rx="%s" ry="%s" '
            'fill="%s"%s/>\n'
            '<path d="%s" transform="translate(%s %s) scale(%s %s)" fill="%s" '
            'stroke="%s" stroke-width="%s" stroke-linejoin="round"/>\n'
            '</svg>\n'
            % (f(bite_c[0]), f(bite_c[1]), f(bite_r), f(r), f(r), bg,
               ' mask="url(#icon-bite)"' if knockout else '',
               d, f(tx), f(ty), f(s, 5), f(-s, 5), letter_fill, letter_stroke, f(sw)))


# ------------------------------------------------------------ slanted tab ----

def build_tab(text='SLICE IT!', angle=-3.0, fill=RED, ink='#FFFFFF',
              shadow=CHAR, track=0.05):
    """Red tilted tab — offers, flashes, calls-to-action.

    Pass text='' for an empty tab to drop your own wording into.
    """
    cap_h = 220.0
    s = cap_h / CAP
    pl = []
    bx0, bx1 = 0.0, 9500.0                 # default width for the blank tab
    if text:
        pl, _ = shape(text, track)
        bx0, _, bx1, _ = run_bbox(pl)
    padx, padt, padb = 120.0, 96.0, 78.0
    tw = (bx1 - bx0) * s + 2 * padx
    th = cap_h + padt + padb
    off = 0.09 * cap_h
    rad = math.radians(-angle)
    # rotated bbox of the tab + its offset shadow
    cx, cy = tw / 2.0, th / 2.0
    pts = [(0, 0), (tw, 0), (tw, th), (0, th)]
    rot = [((x - cx) * math.cos(rad) - (y - cy) * math.sin(rad) + cx,
            (x - cx) * math.sin(rad) + (y - cy) * math.cos(rad) + cy) for x, y in pts]
    xs = [p[0] for p in rot] + [p[0] + off for p in rot]
    ys = [p[1] for p in rot] + [p[1] + off for p in rot]
    pad = 6.0
    x0, x1 = min(xs) - pad, max(xs) + pad
    y0, y1 = min(ys) - pad, max(ys) + pad
    w, h = x1 - x0, y1 - y0

    glyphs = '\n'.join(
        '      <path d="%s" transform="translate(%s %s) scale(%s %s)"/>'
        % (glyph_d(g), f(padx + (dx - bx0) * s), f(padt + cap_h - dy * s),
           f(s, 5), f(-s, 5))
        for g, dx, dy in pl if glyph_d(g)) or '      <!-- your wording here -->'

    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" '
            'height="%s" role="img" aria-label="%s">\n<title>%s</title>\n'
            '<g transform="translate(%s %s)">\n'
            '  <g transform="rotate(%s %s %s)">\n'
            '    <rect x="%s" y="%s" width="%s" height="%s" fill="%s" opacity=".55"/>\n'
            '    <rect x="0" y="0" width="%s" height="%s" fill="%s"/>\n'
            '    <g fill="%s">\n%s\n    </g>\n'
            '  </g>\n</g>\n</svg>\n'
            % (f(w), f(h), f(w / 4.0), f(h / 4.0), esc(text), esc(text),
               f(-x0), f(-y0), f(angle), f(cx), f(cy),
               f(off), f(off), f(tw), f(th), shadow,
               f(tw), f(th), fill, ink, glyphs))


# ---------------------------------------------------------------- star -------

def star_path(r_out=100.0, r_in=42.0, points=5, rot=-90.0):
    pts = []
    for i in range(points * 2):
        a = math.radians(rot + i * 180.0 / points)
        rr = r_out if i % 2 == 0 else r_in
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return 'M ' + ' L '.join('%s %s' % (f(x), f(y)) for x, y in pts) + ' Z'


def build_star(fill=RED):
    r = 100.0
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" '
            'width="200" height="200" role="img" aria-label="Big Bites star">\n'
            '<title>Star</title>\n<path d="%s" fill="%s"/>\n</svg>\n'
            % (f(-r), f(-r), f(2 * r), f(2 * r), star_path(r, 0.42 * r), fill))


# --------------------------------------------------------- ticker strip ------

def build_ticker(words=('SLICE IT', 'BIG BITES', 'FRESH & LOADED'),
                 fill=RED, ink='#FFFFFF', rule=CHAR, track=0.10, reps=2):
    cap_h = 150.0
    s = cap_h / CAP
    star_r = 0.30 * cap_h
    gap = 0.62 * cap_h
    seq = []
    x = gap
    for _ in range(reps):
        for wd in words:
            pl, adv = shape(wd, track)
            bx0, _, bx1, _ = run_bbox(pl)
            for g, dx, dy in pl:
                d = glyph_d(g)
                if d:
                    seq.append(('g', d, x + (dx - bx0) * s, dy))
            x += (bx1 - bx0) * s + gap
            seq.append(('s', None, x + star_r, 0))
            x += 2 * star_r + gap
    total = x
    bar_h = cap_h + 2 * 0.42 * cap_h
    top = 0.42 * cap_h
    rw = 0.055 * cap_h
    H = bar_h + 2 * rw
    glyphs = '\n'.join(
        '    <path d="%s" transform="translate(%s %s) scale(%s %s)"/>'
        % (d, f(px), f(rw + top + cap_h - dy * s), f(s, 5), f(-s, 5))
        for kind, d, px, dy in seq if kind == 'g')
    stars = '\n'.join(
        '    <path d="%s" transform="translate(%s %s)"/>'
        % (star_path(star_r, 0.42 * star_r), f(px), f(rw + top + cap_h * 0.5))
        for kind, d, px, dy in seq if kind == 's')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" '
            'height="%s" preserveAspectRatio="xMinYMid slice" role="img" '
            'aria-label="Slice it. Big Bites. Fresh and loaded.">\n'
            '<title>Big Bites ticker strip</title>\n'
            '<rect x="0" y="0" width="%s" height="%s" fill="%s"/>\n'
            '<rect x="0" y="0" width="%s" height="%s" fill="%s"/>\n'
            '<rect x="0" y="%s" width="%s" height="%s" fill="%s"/>\n'
            '<g fill="%s">\n%s\n%s\n</g>\n</svg>\n'
            % (f(total), f(H), f(total / 8.0), f(H / 8.0),
               f(total), f(H), fill,
               f(total), f(rw), rule,
               f(H - rw), f(total), f(rw), rule,
               ink, glyphs, stars))


# --------------------------------------------------------- dotted rule -------

def build_dotted_rule(n=13, fill=RED):
    dw, dh, gap = 56.0, 28.0, 36.0
    w = n * dw + (n - 1) * gap
    dashes = '\n'.join('  <rect x="%s" y="0" width="%s" height="%s"/>'
                       % (f(i * (dw + gap)), f(dw), f(dh)) for i in range(n))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" '
            'height="%s" role="img" aria-label="Divider">\n<title>Dotted rule</title>\n'
            '<g fill="%s">\n%s\n</g>\n</svg>\n'
            % (f(w), f(dh), f(w / 4.0), f(dh / 4.0), fill, dashes))


# ------------------------------------------------------- location lockup -----

def build_lockup(town, strap=CHAR, track=TRACK):
    """Stacked wordmark with a ★ TOWN strap under it.

    `strap` is the strap colour: charcoal reads on cream/white/yellow/red,
    yellow is the version for charcoal and photo backgrounds.
    """
    inner = build_wordmark(bite='charcoal', track=track)
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', inner)
    ww, wh = float(m.group(1)), float(m.group(2))
    body = inner.split('\n', 2)[2].rsplit('</svg>', 1)[0]

    cap_h = 0.155 * wh
    s = cap_h / CAP
    pl, adv = shape(town.upper(), 0.16)
    bx0, _, bx1, _ = run_bbox(pl)
    star_r = 0.34 * cap_h
    sgap = 0.55 * cap_h
    strap_w = 2 * star_r + sgap + (bx1 - bx0) * s
    sx = (ww - strap_w) / 2.0
    gap_above = 0.10 * wh
    total_h = wh + gap_above + cap_h * 1.2

    glyphs = '\n'.join(
        '    <path d="%s" transform="translate(%s %s) scale(%s %s)"/>'
        % (glyph_d(g), f(sx + 2 * star_r + sgap + (dx - bx0) * s), f(cap_h - dy * s),
           f(s, 5), f(-s, 5))
        for g, dx, dy in pl if glyph_d(g))

    return ('<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 %s %s" width="%s" '
            'height="%s" role="img" aria-label="Big Bites %s">\n'
            '<title>Big Bites %s</title>\n%s'
            '<g transform="translate(0 %s)" fill="%s">\n'
            '  <path d="%s" transform="translate(%s %s)"/>\n%s\n</g>\n</svg>\n'
            % (f(ww), f(total_h), f(ww / 4.0), f(total_h / 4.0), town, town, body,
               f(wh + gap_above), strap,
               star_path(star_r, 0.42 * star_r), f(sx + star_r), f(cap_h * 0.5),
               glyphs))


# ------------------------------------------------------------------ main -----

def write(name, svg):
    # Namespace every internal id to the filename. Two of these inlined in one
    # HTML page would otherwise share an id and steal each other's mask.
    slug = re.sub(r'[^a-z0-9]+', '-', name[:-4].lower()).strip('-')
    for ident in sorted(set(re.findall(r'\bid="([^"]+)"', svg))):
        new = '%s-%s' % (slug, ident)
        svg = svg.replace('id="%s"' % ident, 'id="%s"' % new)
        svg = svg.replace('url(#%s)' % ident, 'url(#%s)' % new)
        svg = svg.replace('href="#%s"' % ident, 'href="#%s"' % new)

    # Every internal reference must resolve inside this same file.
    have = set(re.findall(r'\bid="([^"]+)"', svg))
    want = set(re.findall(r'href="#([^"]+)"', svg)) | set(re.findall(r'url\(#([^)]+)\)', svg))
    missing = want - have
    if missing:
        raise SystemExit('%s: dangling references %s' % (name, sorted(missing)))
    path = os.path.join(OUT, name)
    with open(path, 'w') as fh:
        fh.write(svg)
    print('%-42s %6d bytes' % (name, len(svg)))


def main():
    os.makedirs(OUT, exist_ok=True)
    write('bigbites-logo-stacked.svg', build_wordmark('charcoal'))
    write('bigbites-logo-stacked-knockout-bite.svg', build_wordmark('knockout'))
    write('bigbites-logo-stacked-black.svg', build_wordmark('knockout', mono=CHAR))
    write('bigbites-logo-stacked-white.svg', build_wordmark('knockout', mono='#FFFFFF'))
    write('bigbites-logo-stacked-yellow.svg', build_wordmark('knockout', mono=YELLOW))
    write('bigbites-logo-horizontal.svg', build_single_line('BIG BITES'))
    write('bigbites-logo-horizontal-black.svg',
          build_single_line('BIG BITES', mono=CHAR, bite='knockout'))
    write('bigbites-logo-horizontal-white.svg',
          build_single_line('BIG BITES', mono='#FFFFFF', bite='knockout'))
    write('bigbites-logo-horizontal-yellow.svg',
          build_single_line('BIG BITES', mono=YELLOW, bite='knockout'))
    write('bigbites-bite-mark-red.svg', build_bite_mark(RED))
    write('bigbites-bite-mark-black.svg', build_bite_mark(CHAR))
    write('bigbites-app-icon.svg', build_app_icon())
    write('bigbites-favicon.svg', build_app_icon(squircle=0.12))
    write('bigbites-tab-slice-it.svg', build_tab('SLICE IT!'))
    write('bigbites-tab-fresh-and-loaded.svg', build_tab('FRESH & LOADED'))
    write('bigbites-tab-2-for-15.svg', build_tab('2 FOR £15'))
    write('bigbites-tab-blank.svg', build_tab(''))
    write('bigbites-star-red.svg', build_star(RED))
    write('bigbites-star-yellow.svg', build_star(YELLOW))
    write('bigbites-ticker-strip.svg', build_ticker())
    write('bigbites-dotted-rule.svg', build_dotted_rule())
    for town in ('Easingwold', 'Selby'):
        slug = town.lower()
        write('bigbites-lockup-%s.svg' % slug, build_lockup(town, strap=CHAR))
        write('bigbites-lockup-%s-on-dark.svg' % slug, build_lockup(town, strap=YELLOW))


if __name__ == '__main__':
    main()
