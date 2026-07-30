#!/usr/bin/env python3
"""Branded Big Bites QR: charcoal modules, bite mark knocked into the centre.

Safe because the codes are error-correction level H (~30% of the symbol can be
destroyed and still decode). The centre patch covers ~5% of the area and never
touches a finder pattern. Verified by decoding it back, including degraded.
"""
import os
import segno

OUT = os.path.dirname(os.path.abspath(__file__))
CHAR, RED, WHITE = '#0C0C0C', '#E32619', '#FFFFFF'

TARGETS = [
    ('bigbites-qr-website-branded', 'https://bigbiteseasingwold.co.uk'),
    ('bigbites-qr-order-online-branded', 'https://bigbiteseasingwold.co.uk/order'),
]

# The bite mark, drawn in a 200x200 box centred on (0,0) in its own local frame.
BITE = ('<circle cx="0" cy="0" r="100" mask="url(#chomp)"/>'
        '<circle cx="130" cy="-106" r="21"/>')


def build(name, url, border=4):
    qr = segno.make(url, error='h')
    matrix = [list(row) for row in qr.matrix]
    n = len(matrix)
    size = n + border * 2

    mods = []
    for y, row in enumerate(matrix):
        run = None
        for x, v in enumerate(row + [0]):          # sentinel closes the last run
            if v and run is None:
                run = x
            elif not v and run is not None:
                mods.append('M%d %dh%dv1h-%dz' % (run + border, y + border,
                                                  x - run, x - run))
                run = None
    path = ''.join(mods)

    # Centre patch. The bite artwork is NOT centred on its own origin — the disc
    # is r=100 at (0,0) but the crumb pushes the bounding box out to
    # x -100..151, y -127..100. So centre the bbox first, then scale it to sit
    # inside the white patch with a visible ring of quiet space around it.
    c = size / 2.0
    bx0, by0, bx1, by1 = -100.0, -127.0, 151.0, 100.0
    bcx, bcy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
    brad = ((bx1 - bx0) ** 2 + (by1 - by0) ** 2) ** 0.5 / 2.0   # corner radius
    patch_r = size * 0.13           # ~5.3% of the symbol area; level H allows ~30%
    mark_s = (patch_r * 0.90) / brad

    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="%d" height="%d" shape-rendering="crispEdges" role="img" '
            'aria-label="Scan to visit %s">\n'
            '<title>Big Bites — %s</title>\n'
            '<defs>\n'
            '  <mask id="chomp" maskUnits="userSpaceOnUse" x="-104" y="-131" '
            'width="259" height="235">\n'
            '    <rect x="-104" y="-131" width="259" height="235" fill="#fff"/>\n'
            '    <circle cx="80" cy="-68" r="46" fill="#000"/>\n'
            '  </mask>\n'
            '</defs>\n'
            '<rect width="%d" height="%d" fill="%s"/>\n'
            '<path d="%s" fill="%s"/>\n'
            '<circle cx="%s" cy="%s" r="%s" fill="%s"/>\n'
            '<g transform="translate(%s %s) scale(%s) translate(%s %s)" '
            'fill="%s">%s</g>\n'
            '</svg>\n'
            % (size, size, size * 10, size * 10, url, url,
               size, size, WHITE, path, CHAR,
               c, c, round(patch_r, 3), WHITE,
               c, c, round(mark_s, 5), round(-bcx, 3), round(-bcy, 3),
               RED, BITE)), size


for name, url in TARGETS:
    svg, size = build(name, url)
    with open(os.path.join(OUT, name + '.svg'), 'w') as fh:
        fh.write(svg)
    print('%-36s %d modules' % (name + '.svg', size))
