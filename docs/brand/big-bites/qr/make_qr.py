#!/usr/bin/env python3
"""Generate the Big Bites print QR codes, then decode them back to prove they scan.

Design choices, all aimed at "must still work in five years on a laminated menu":
  * Encode the APEX over https. www would 301 to the apex (public/_redirects) —
    an extra round trip and one more thing to fail. http would redirect too.
  * No URL shortener. A shortener puts a third party between the printed menu
    and the shop: if that service dies or the account lapses, every menu ever
    printed is dead paper. Encoding the real domain has no such dependency.
  * Error correction H (~30% recoverable) so the designer can drop the bite mark
    in the middle, and so scuffs and grease on a menu don't kill the scan.
  * Charcoal #0C0C0C on white. Brand-correct and effectively black; QR contrast
    is not the place to be clever.
"""
import os
import cv2
import numpy as np
import segno

OUT = os.path.dirname(os.path.abspath(__file__))
CHAR = '#0C0C0C'

TARGETS = [
    ('bigbites-qr-website', 'https://bigbiteseasingwold.co.uk'),
    ('bigbites-qr-order-online', 'https://bigbiteseasingwold.co.uk/order'),
]


def build(name, url):
    qr = segno.make(url, error='h', micro=False)
    svg = os.path.join(OUT, name + '.svg')
    png = os.path.join(OUT, name + '.png')
    # scale/border are in modules; border=4 is the spec-mandated quiet zone.
    qr.save(svg, kind='svg', scale=10, border=4, dark=CHAR, light='#FFFFFF')
    qr.save(png, kind='png', scale=40, border=4, dark=CHAR, light='#FFFFFF')
    return qr, svg, png


def verify(png, expected):
    """Decode the rendered PNG back. If this fails, do not send it to a printer."""
    img = cv2.imread(png)
    data, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    ok = (data == expected)
    # Also decode a deliberately degraded copy: shrunk to phone-camera-ish size
    # and blurred, to approximate a scan of a printed menu in poor light.
    small = cv2.resize(img, (240, 240), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (3, 3), 0)
    d2, _, _ = cv2.QRCodeDetector().detectAndDecode(small)
    return ok, data, (d2 == expected)


print('%-28s %-9s %-7s %s' % ('file', 'version', 'clean', 'degraded(240px+blur)'))
for name, url in TARGETS:
    qr, svg, png = build(name, url)
    ok, got, ok2 = verify(png, url)
    print('%-28s v%-8s %-7s %s   -> %s'
          % (name, qr.version, 'PASS' if ok else 'FAIL',
             'PASS' if ok2 else 'FAIL', got or '(nothing decoded)'))
    if not ok:
        raise SystemExit('QR did not decode back to its URL — do not print this.')
