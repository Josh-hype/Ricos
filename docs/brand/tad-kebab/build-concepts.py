#!/usr/bin/env python3
"""Tad Kebab — logo concepts as real outline geometry.

Same approach as the Big Bites kit: glyphs are converted to outlines so the
files carry no font dependency. Nobody downstream needs the typeface installed,
and a sign maker's RIP renders exactly what we see.

Outputs one SVG per concept into svg/.
"""
import os, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, 'fonts')
OUT = os.path.join(HERE, 'svg')
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- palette ---
# Light and warm: cream carries the design, red does the shouting. The near-
# black is deliberately brown-tinted — a pure #000 keyline goes cold and hard
# against cream, which is the opposite of what a kebab shop wants to feel like.
BOWLBY_PATH = os.path.join(FONTS, 'BowlbyOneSC-Regular.ttf')

CREAM     = '#FBF2E2'
CREAM_DK  = '#F0E2C8'
RED       = '#D33A2C'
RED_DEEP  = '#A32419'
CHAR      = '#2B2119'
GOLD      = '#E9A63C'


class Face:
    def __init__(self, path):
        self.font = TTFont(path)
        self.upm = self.font['head'].unitsPerEm
        self.cap = self.font['OS/2'].sCapHeight
        self.glyphset = self.font.getGlyphSet()
        self.order = self.font.getGlyphOrder()
        blob = hb.Blob.from_file_path(path)
        self.hb = hb.Font(hb.Face(blob))

    def glyph_d(self, gname):
        pen = SVGPathPen(self.glyphset)
        self.glyphset[gname].draw(pen)
        d = pen.getCommands()
        if not d:
            return ''
        return re.sub(r'-?\d+\.\d+',
                      lambda m: (('%f' % round(float(m.group(0)), 1))
                                 .rstrip('0').rstrip('.') or '0'), d)

    def shape(self, text, tracking=0.0):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf)
        extra = tracking * self.upm
        out, x = [], 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            out.append((self.order[info.codepoint], x + pos.x_offset, pos.y_offset))
            x += pos.x_advance + extra
        return out, max(0.0, x - extra)

    def bbox(self, placements):
        glyf = self.font['glyf']
        x0 = y0 = 1e9
        x1 = y1 = -1e9
        for gname, dx, dy in placements:
            g = glyf[gname]
            if g.numberOfContours == 0:
                continue
            x0, x1 = min(x0, g.xMin + dx), max(x1, g.xMax + dx)
            y0, y1 = min(y0, g.yMin + dy), max(y1, g.yMax + dy)
        return x0, y0, x1, y1


def f(v, nd=2):
    return ('%.*f' % (nd, v)).rstrip('0').rstrip('.') or '0'


def run_paths(face, placements, cls='', extra=''):
    """Glyphs as <path>, flipped y-up -> y-down."""
    out = []
    klass = (' class="%s"' % cls) if cls else ''
    for gname, dx, dy in placements:
        d = face.glyph_d(gname)
        if not d:
            continue
        out.append(f'<path transform="translate({f(dx)},{f(dy)}) scale(1,-1)" '
                   f'd="{d}"{klass}{extra}/>')
    return '\n      '.join(out)


# ------------------------------------------------------------- the skewer ---
def skewer(w, y, thick, fill=CHAR):
    """The signature device: a flat skewer with a pointed tip and a looped tail.

    Big Bites has its bite; this is the equivalent for Tad — a mark that works
    as a divider, an underline, a bullet, or run through a photo edge.

    Deliberately heavy. The first pass drew it at a realistic skewer's
    proportions, which looked right at 300px and turned into a stray hairline
    at favicon size — a logo has to survive being 64px in a browser tab, so the
    rod is thickened well past life-like and the loop is solid rather than a
    thin ring. Colour is a parameter because the first version was charcoal on
    every background and simply vanished on the dark one.
    """
    h = thick
    tip_len = h * 2.6
    loop_r = h * 1.15
    x0 = loop_r * 2
    body = (f'M{f(x0)},{f(y - h/2)} '
            f'H{f(w - tip_len)} '
            f'L{f(w)},{f(y)} '
            f'L{f(w - tip_len)},{f(y + h/2)} '
            f'H{f(x0)} Z')
    return (f'<path d="{body}" fill="{fill}"/>'
            f'<circle cx="{f(loop_r)}" cy="{f(y)}" r="{f(loop_r * 0.98)}" '
            f'fill="none" stroke="{fill}" stroke-width="{f(h * 0.78)}"/>')


def svg(w, h, body, bg=None, title=''):
    ground = f'<rect width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" '
            f'width="{f(w)}" height="{f(h)}" role="img" aria-label="{title}">\n'
            f'  <title>{title}</title>\n  {ground}\n  {body}\n</svg>\n')


# ============================================================== concept A ====
def concept_a(path, stacked=True, ink=CHAR, faces=RED, town=None):
    """Titan One, red faces on a keyline, skewer under, optional town strap.

    The keyline does the heavy lifting: red on cream is a low-contrast pairing
    and the letters go muddy at small sizes without one. `ink` flips the keyline
    and skewer to cream for dark backgrounds — on charcoal a charcoal keyline is
    just a hole around every letter.
    """
    face = Face(path)
    S = 0.16                       # font units -> user units
    track = 0.01
    lines = ['TAD', 'KEBAB'] if stacked else ['TAD KEBAB']
    keyline = face.cap * 0.055

    runs = []
    for i, line in enumerate(lines):
        pl, adv = face.shape(line, track)
        runs.append((line, pl, adv))
    widest = max(a for _, _, a in runs)
    gap = face.cap * 1.30

    inner = []
    for i, (line, pl, adv) in enumerate(runs):
        dx = (widest - adv) / 2
        dy = i * gap
        inner.append(f'<g transform="translate({f(dx)},{f(dy)})">'
                     f'{run_paths(face, pl)}</g>')
    glyphs = '\n      '.join(inner)

    # Everything below is measured from the FIRST line's baseline, because that
    # is where the group's origin sits. Mixing that up with distance-from-the-top
    # is what pushed the town strap off the bottom of the canvas first time.
    last_baseline = gap * (len(runs) - 1)
    sk_y = last_baseline + face.cap * 0.40
    strap = ''
    bottom = sk_y + face.cap * 0.18

    if town:
        tface = Face(BOWLBY_PATH)
        tpl, tadv = tface.shape(town, 0.14)
        ts = (face.cap * 0.30) / tface.cap          # town cap = 30% of main cap
        tw = tadv * ts
        ty = sk_y + face.cap * 0.62
        strap = (f'<g transform="translate({f((widest - tw) / 2)},{f(ty)}) '
                 f'scale({f(ts, 5)})" fill="{ink}">{run_paths(tface, tpl)}</g>')
        bottom = ty + face.cap * 0.10

    pad = face.cap * 0.30
    W = (widest + pad * 2) * S
    H = (pad * 2 + face.cap + bottom) * S

    body = f'''<g transform="translate({f(pad * S)},{f((pad + face.cap) * S)}) scale({f(S, 5)})">
      <g stroke="{ink}" stroke-width="{f(keyline * 2)}" stroke-linejoin="round" fill="{ink}">
      {glyphs}
      </g>
      <g fill="{faces}">
      {glyphs}
      </g>
      {skewer(widest, sk_y, face.cap * 0.115, fill=ink)}
      {strap}
    </g>'''
    return svg(W, H, body, title='Tad Kebab')


# ============================================================== concept B ====
def concept_b(path):
    """Bowlby One SC, cream letters knocked out of a red rounded panel.

    The most legible from across a road, and the easiest to reproduce — one
    colour plus the paper. Cheap on vinyl, cheap on boxes, no keyline needed.
    """
    face = Face(path)
    S = 0.16
    pl, adv = face.shape('TAD KEBAB', 0.015)
    padx, pady = face.cap * 0.45, face.cap * 0.38
    W = (adv + padx * 2) * S
    H = (face.cap + pady * 2) * S
    r = H * 0.22

    body = f'''<rect x="0" y="0" width="{f(W)}" height="{f(H)}" rx="{f(r)}" fill="{RED}"/>
    <g transform="translate({f(padx * S)},{f((pady + face.cap) * S)}) scale({f(S, 5)})" fill="{CREAM}">
      {run_paths(face, pl)}
    </g>'''
    return svg(W, H, body, title='Tad Kebab')


# ============================================================== concept C ====
def concept_c(path):
    """Lilita One stacked with a deep-red extrude — depth without a keyline.

    The extrude is swept as discrete copies rather than faked with a blur, so
    it stays crisp cut in vinyl and survives being scaled to a shop sign.
    """
    face = Face(path)
    S = 0.16
    track = 0.012
    lines = ['TAD', 'KEBAB']
    ext_x, ext_y = face.cap * 0.085, face.cap * 0.095
    steps = 26

    runs = [(l,) + face.shape(l, track) for l in lines]
    widest = max(a for _, _, a in runs)
    gap = face.cap * 1.22

    inner = []
    for i, (line, pl, adv) in enumerate(runs):
        dx = (widest - adv) / 2
        dy = i * gap
        inner.append(f'<g transform="translate({f(dx)},{f(dy)})">{run_paths(face, pl)}</g>')
    glyphs = '\n      '.join(inner)

    sweep = []
    for s in range(steps, 0, -1):
        t = s / steps
        sweep.append(f'<g transform="translate({f(ext_x * t)},{f(ext_y * t)})" '
                     f'fill="{RED_DEEP}" stroke="{RED_DEEP}" stroke-width="{f(face.cap * 0.012)}">'
                     f'{glyphs}</g>')
    shadow = '\n      '.join(sweep)

    total_h = face.cap + gap * (len(runs) - 1)
    pad = face.cap * 0.28
    W = (widest + pad * 2 + ext_x) * S
    H = (total_h + pad * 2 + ext_y) * S

    body = f'''<g transform="translate({f(pad * S)},{f((pad + face.cap) * S)}) scale({f(S, 5)})">
      {shadow}
      <g fill="{RED}">
      {glyphs}
      </g>
    </g>'''
    return svg(W, H, body, title='Tad Kebab')


# ------------------------------------------------------------------ write ---
TITAN = os.path.join(FONTS, 'TitanOne-Regular.ttf')
BOWLBY = BOWLBY_PATH
LILITA = os.path.join(FONTS, 'LilitaOne-Regular.ttf')

jobs = [
    ('tad-concept-a-stacked.svg',      lambda: concept_a(TITAN)),
    ('tad-concept-a-on-dark.svg',      lambda: concept_a(TITAN, ink=CREAM)),
    # Red letters cannot sit on a red ground, so the on-red variant knocks the
    # faces out in cream and keeps the charcoal keyline.
    ('tad-concept-a-on-red.svg',       lambda: concept_a(TITAN, ink=CHAR, faces=CREAM)),
    ('tad-concept-a-tadcaster.svg',    lambda: concept_a(TITAN, town='TADCASTER')),
    ('tad-concept-b-panel.svg',        lambda: concept_b(BOWLBY)),
    ('tad-concept-c-extrude.svg',      lambda: concept_c(LILITA)),
]
for name, fn in jobs:
    out = fn()
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write(out)
    print(f'{name}: {len(out)} bytes')
print('palette:', CREAM, RED, RED_DEEP, CHAR, GOLD)
