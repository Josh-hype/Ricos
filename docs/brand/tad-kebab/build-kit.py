#!/usr/bin/env python3
"""Tad Kebab — vector brand kit.

Every file is real outline geometry: glyphs are converted to paths, so nothing
downstream needs Titan One or Bowlby One installed. Open them in Illustrator,
Inkscape, Affinity, Canva, a browser or a printer's RIP and they render the
same. Scale to a shop sign or down to a favicon.

    pip install fonttools uharfbuzz
    python3 build-kit.py

Writes svg/. See README.md for which file to send where.
"""
import os, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, 'fonts')
OUT = os.environ.get('TK_OUT', os.path.join(HERE, 'svg'))
os.makedirs(OUT, exist_ok=True)

TITAN = os.path.join(FONTS, 'TitanOne-Regular.ttf')      # wordmark
BOWLBY = os.path.join(FONTS, 'BowlbyOneSC-Regular.ttf')  # straps, tabs, ticker

# ---------------------------------------------------------------- palette ---
CREAM    = '#FBF2E2'
RED      = '#D33A2C'
RED_DEEP = '#A32419'
CHAR     = '#2B2119'
GOLD     = '#E9A63C'
WHITE    = '#FFFFFF'


class Face:
    _cache = {}

    def __new__(cls, path):
        if path in cls._cache:
            return cls._cache[path]
        self = super().__new__(cls)
        self._init(path)
        cls._cache[path] = self
        return self

    def _init(self, path):
        self.font = TTFont(path)
        self.upm = self.font['head'].unitsPerEm
        self.cap = self.font['OS/2'].sCapHeight
        self.glyphset = self.font.getGlyphSet()
        self.order = self.font.getGlyphOrder()
        self.hb = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
        self._d = {}

    def glyph_d(self, gname):
        if gname not in self._d:
            pen = SVGPathPen(self.glyphset)
            self.glyphset[gname].draw(pen)
            d = pen.getCommands() or ''
            self._d[gname] = re.sub(
                r'-?\d+\.\d+',
                lambda m: (('%f' % round(float(m.group(0)), 1))
                           .rstrip('0').rstrip('.') or '0'), d)
        return self._d[gname]

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


def f(v, nd=2):
    return ('%.*f' % (nd, v)).rstrip('0').rstrip('.') or '0'


def esc(t):
    return (t.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))


def run_paths(face, placements):
    out = []
    for gname, dx, dy in placements:
        d = face.glyph_d(gname)
        if not d:
            continue
        out.append(f'<path transform="translate({f(dx)},{f(dy)}) scale(1,-1)" d="{d}"/>')
    return '\n      '.join(out)


def svg(w, h, body, bg=None, title='Tad Kebab'):
    ground = f'<rect width="{f(w)}" height="{f(h)}" fill="{bg}"/>\n  ' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" '
            f'width="{f(w)}" height="{f(h)}" role="img" aria-label="{esc(title)}">\n'
            f'  <title>{esc(title)}</title>\n  {ground}{body}\n</svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write(content)
    return name, len(content)


# ------------------------------------------------------------- the skewer ---
def skewer_markup(w, y, thick, fill):
    """Flat skewer: looped tail, straight rod, pointed tip.

    Heavier than a real skewer on purpose. Drawn at lifelike proportions it
    became a stray hairline at favicon size, which is the one size a logo has
    to survive without help.
    """
    h = thick
    tip_len = h * 2.6
    loop_r = h * 1.15
    x0 = loop_r * 2
    rod = (f'M{f(x0)},{f(y - h/2)} H{f(w - tip_len)} L{f(w)},{f(y)} '
           f'L{f(w - tip_len)},{f(y + h/2)} H{f(x0)} Z')
    return (f'<path d="{rod}" fill="{fill}"/>'
            f'<circle cx="{f(loop_r)}" cy="{f(y)}" r="{f(loop_r * 0.98)}" '
            f'fill="none" stroke="{fill}" stroke-width="{f(h * 0.78)}"/>')


# ------------------------------------------------------------- the logo -----
S = 0.16          # font units -> user units
TRACK = 0.01


def _wordmark(lines, track=TRACK):
    """Shaped, centred lines. Returns (markup, widest, gap, face)."""
    face = Face(TITAN)
    runs = [(l,) + face.shape(l, track) for l in lines]
    widest = max(a for _, _, a in runs)
    gap = face.cap * 1.30
    parts = []
    for i, (_, pl, adv) in enumerate(runs):
        parts.append(f'<g transform="translate({f((widest - adv) / 2)},{f(i * gap)})">'
                     f'{run_paths(face, pl)}</g>')
    return '\n      '.join(parts), widest, gap, face


def build_logo(lines=('TAD', 'KEBAB'), faces=RED, ink=CHAR, town=None,
               skewer=True, mono=None, title='Tad Kebab'):
    """The logo.

    `mono` collapses faces and keyline into one colour for vinyl, embroidery,
    a stamp or a fax — the keyline stroke then simply fattens the letterform
    slightly, which is what you want when there is only one ink.
    """
    if mono:
        faces = ink = mono
    glyphs, widest, gap, face = _wordmark(lines)
    keyline = face.cap * 0.055

    # Measured from the FIRST line's baseline: that is the group's origin.
    last_baseline = gap * (len(lines) - 1)
    sk_y = last_baseline + face.cap * 0.40
    bottom = sk_y + face.cap * 0.18 if skewer else last_baseline + face.cap * 0.10
    strap = ''

    if town:
        tface = Face(BOWLBY)
        tpl, tadv = tface.shape(town, 0.14)
        ts = (face.cap * 0.30) / tface.cap
        ty = sk_y + face.cap * 0.62
        strap = (f'<g transform="translate({f((widest - tadv * ts) / 2)},{f(ty)}) '
                 f'scale({f(ts, 5)})" fill="{ink}">{run_paths(tface, tpl)}</g>')
        bottom = ty + face.cap * 0.10

    pad = face.cap * 0.30
    W = (widest + pad * 2) * S
    H = (pad * 2 + face.cap + bottom) * S
    sk = skewer_markup(widest, sk_y, face.cap * 0.115, ink) if skewer else ''

    body = f'''<g transform="translate({f(pad * S)},{f((pad + face.cap) * S)}) scale({f(S, 5)})">
      <g stroke="{ink}" stroke-width="{f(keyline * 2)}" stroke-linejoin="round" fill="{ink}">
      {glyphs}
      </g>
      <g fill="{faces}">
      {glyphs}
      </g>
      {sk}
      {strap}
    </g>'''
    return svg(W, H, body, title=title)


# --------------------------------------------------------- standalone mark --
def build_skewer(fill=CHAR):
    """The device on its own — a divider, an underline, a bullet."""
    w, thick = 1000.0, 42.0
    h = thick * 3.2
    body = f'<g>{skewer_markup(w, h / 2, thick, fill)}</g>'
    return svg(w, h, body, title='Tad Kebab skewer')


def build_rule(n=15, fill=RED):
    """Dashed divider for menus and price lists."""
    dash, gapw, r = 26.0, 22.0, 5.0
    w = n * (dash + gapw) - gapw
    body = ''.join(
        f'<rect x="{f(i * (dash + gapw))}" y="0" width="{f(dash)}" height="{f(r * 2)}" '
        f'rx="{f(r)}" fill="{fill}"/>' for i in range(n))
    return svg(w, r * 2, body, title='Tad Kebab rule')


# -------------------------------------------------------------- app icon ----
def build_app_icon(bg=RED, ink=CREAM, radius=0.22):
    """Home-screen icon: TAD over the skewer, on red.

    Deliberately not the full lockup. KEBAB and the town strap are illegible at
    120px, and an icon that tries to say everything says nothing.
    """
    size = 1024.0
    face = Face(TITAN)
    pl, adv = face.shape('TAD', 0.01)
    s = (size * 0.56) / adv
    cap = face.cap * s
    x = (size - adv * s) / 2
    y = size * 0.50 + cap / 2
    sk_w = adv * s
    sk_y = y + cap * 0.38
    body = (f'<rect width="{f(size)}" height="{f(size)}" rx="{f(size * radius)}" fill="{bg}"/>'
            f'<g transform="translate({f(x)},{f(y)}) scale({f(s, 5)})" fill="{ink}">'
            f'{run_paths(face, pl)}</g>'
            f'<g transform="translate({f(x)},0)">'
            f'{skewer_markup(sk_w, sk_y, cap * 0.115, ink)}</g>')
    return svg(size, size, body, title='Tad Kebab app icon')


def build_favicon(bg=RED, ink=CREAM):
    """16px survival: one letter, nothing else."""
    size = 512.0
    face = Face(TITAN)
    pl, adv = face.shape('T')
    s = (size * 0.52) / adv
    x = (size - adv * s) / 2
    y = size / 2 + (face.cap * s) / 2
    body = (f'<rect width="{f(size)}" height="{f(size)}" rx="{f(size * 0.22)}" fill="{bg}"/>'
            f'<g transform="translate({f(x)},{f(y)}) scale({f(s, 5)})" fill="{ink}">'
            f'{run_paths(face, pl)}</g>')
    return svg(size, size, body, title='Tad Kebab favicon')


# ------------------------------------------------------------ slanted tab ---
def build_tab(text='FRESH OFF THE GRILL', angle=-3.0, bg=RED, ink=CREAM):
    """Offer flash. Slight rotation so it reads as stuck on, not set in."""
    face = Face(BOWLBY)
    pl, adv = face.shape(text, 0.03)
    s = 0.20
    padx, pady = face.cap * 0.42 * s, face.cap * 0.40 * s
    tw, th = adv * s, face.cap * s
    W, H = tw + padx * 2, th + pady * 2
    import math
    rad = abs(angle) * math.pi / 180
    OW = W * math.cos(rad) + H * math.sin(rad)
    OH = W * math.sin(rad) + H * math.cos(rad)
    body = (f'<g transform="translate({f(OW / 2)},{f(OH / 2)}) rotate({f(angle)}) '
            f'translate({f(-W / 2)},{f(-H / 2)})">'
            f'<rect width="{f(W)}" height="{f(H)}" rx="{f(H * 0.16)}" fill="{bg}"/>'
            f'<g transform="translate({f(padx)},{f(pady + th)}) scale({f(s, 5)})" fill="{ink}">'
            f'{run_paths(face, pl)}</g></g>')
    return svg(OW, OH, body, title=f'Tad Kebab tab — {text}')


# --------------------------------------------------------- ticker strip -----
def build_ticker(words=('TAD KEBAB', 'TADCASTER', 'PIZZA', 'KEBABS', 'BURGERS'),
                 bg=RED, ink=CREAM):
    """Repeating band for menu headers and shopfront glazing. Tiles: crop to any width.

    Every word is its own item and every separator is the same dot at the same
    spacing. The first pass had literal '·' characters inside one phrase AND
    drawn dots between phrases — two separators at two spacings in one strip,
    which looks like a mistake because it is one.
    """
    face = Face(BOWLBY)
    s = 0.20
    gap = face.cap * 0.42 * s        # half the space either side of a dot
    dot_r = face.cap * 0.085 * s
    items, x = [], gap * 2
    for w in words:
        pl, adv = face.shape(w, 0.05)
        items.append((pl, adv * s, x))
        x += adv * s
        items.append((None, 0, x + gap))   # dot centred in the 2*gap that follows
        x += gap * 2
    H = face.cap * s * 2.0
    baseline = H / 2 + (face.cap * s) / 2
    parts = [f'<rect width="{f(x)}" height="{f(H)}" fill="{bg}"/>']
    for pl, w, px in items:
        if pl is None:
            parts.append(f'<circle cx="{f(px)}" cy="{f(H / 2)}" r="{f(dot_r)}" fill="{ink}"/>')
        else:
            parts.append(f'<g transform="translate({f(px)},{f(baseline)}) scale({f(s, 5)})" '
                         f'fill="{ink}">{run_paths(face, pl)}</g>')
    return svg(x, H, '\n  '.join(parts), title='Tad Kebab ticker strip')


# ------------------------------------------------------------------ build ---
JOBS = [
    # Primary
    ('tadkebab-logo-stacked.svg',            lambda: build_logo()),
    ('tadkebab-logo-stacked-on-dark.svg',    lambda: build_logo(ink=CREAM)),
    ('tadkebab-logo-stacked-knockout.svg',   lambda: build_logo(faces=CREAM, ink=CHAR)),
    # One colour
    ('tadkebab-logo-stacked-black.svg',      lambda: build_logo(mono=CHAR)),
    ('tadkebab-logo-stacked-white.svg',      lambda: build_logo(mono=WHITE)),
    ('tadkebab-logo-stacked-red.svg',        lambda: build_logo(mono=RED)),
    # Horizontal
    ('tadkebab-logo-horizontal.svg',         lambda: build_logo(lines=('TAD KEBAB',))),
    ('tadkebab-logo-horizontal-on-dark.svg', lambda: build_logo(lines=('TAD KEBAB',), ink=CREAM)),
    ('tadkebab-logo-horizontal-black.svg',   lambda: build_logo(lines=('TAD KEBAB',), mono=CHAR)),
    ('tadkebab-logo-horizontal-white.svg',   lambda: build_logo(lines=('TAD KEBAB',), mono=WHITE)),
    # Town lockups
    ('tadkebab-lockup-tadcaster.svg',        lambda: build_logo(town='TADCASTER')),
    ('tadkebab-lockup-tadcaster-on-dark.svg', lambda: build_logo(town='TADCASTER', ink=CREAM)),
    ('tadkebab-lockup-tadcaster-knockout.svg', lambda: build_logo(town='TADCASTER', faces=CREAM)),
    # Toolkit
    ('tadkebab-skewer-black.svg',            lambda: build_skewer(CHAR)),
    ('tadkebab-skewer-red.svg',              lambda: build_skewer(RED)),
    ('tadkebab-skewer-cream.svg',            lambda: build_skewer(CREAM)),
    ('tadkebab-rule.svg',                    lambda: build_rule()),
    ('tadkebab-tab-off-the-grill.svg',       lambda: build_tab('FRESH OFF THE GRILL')),
    ('tadkebab-tab-order-online.svg',        lambda: build_tab('ORDER ONLINE')),
    ('tadkebab-tab-blank.svg',               lambda: build_tab('          ')),
    ('tadkebab-ticker-strip.svg',            lambda: build_ticker()),
    # Icons
    ('tadkebab-app-icon.svg',                lambda: build_app_icon()),
    ('tadkebab-favicon.svg',                 lambda: build_favicon()),
]

if __name__ == '__main__':
    total = 0
    for name, fn in JOBS:
        n, size = write(name, fn())
        total += size
        print(f'  {n:44s} {size:>7,d} bytes')
    print(f'\n{len(JOBS)} files, {total:,d} bytes -> {OUT}')
    print('palette:', CREAM, RED, RED_DEEP, CHAR, GOLD)
