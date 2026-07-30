# Big Bites QR codes — for print

Four codes. All vector SVG plus a 1600px PNG. Send the **SVG** to a printer or
designer; the PNG is only for screens and messaging apps.

| File | Points at | Use it for |
|---|---|---|
| `bigbites-qr-order-online-branded.svg` | `https://bigbiteseasingwold.co.uk/order` | **Printed menus, tables, boxes, flyers** — scan and you're ordering |
| `bigbites-qr-website-branded.svg` | `https://bigbiteseasingwold.co.uk` | Shopfront, van, business cards, socials |
| `bigbites-qr-order-online.svg` | `…/order` | Plain, no logo — for one-colour print or a very small reproduction |
| `bigbites-qr-website.svg` | homepage | Plain, no logo |

## Rules for whoever lays these out

- **Minimum printed size 20 mm × 20 mm**, 25 mm or more preferred. Below that,
  phone cameras start to struggle.
- **Keep the white margin.** The quiet zone around the code is part of the code.
  Don't crop it, and don't let artwork or a border run into it.
- **Don't recolour, invert, stretch or rotate** the pattern. Dark modules on a
  light background only — light-on-dark defeats a lot of scanners.
- Print it on a **flat, matt** area if you can. Gloss and curves scatter the
  camera's view.
- Use the SVG so it stays sharp at any size.

## Will these work forever?

The things that usually kill a printed QR code have been designed out:

- **No URL shortener.** This is how most printed codes die — the code points at
  a third-party short link, that account lapses or the service shuts down, and
  every menu ever printed becomes dead paper. These encode the shop's own
  address directly, so there is no middleman to fail.
- **The apex over https** (`https://bigbiteseasingwold.co.uk`), not `www` and not
  `http`. Both of those would redirect, adding a round trip and one more thing
  to break. The apex is the host that serves directly.
- **Error correction level H** — roughly 30% of the symbol can be destroyed and
  it still decodes. That is what makes the logo in the middle safe, and it buys
  a lot of tolerance for grease, scuffs and folds on a menu.
- **Redesigns don't matter.** A QR code encodes a web address, not a page. The
  site can be rebuilt from scratch and the code is unaffected.

**The one thing that would kill them: letting the domain lapse.** Printed menus
outlive card details. So:

1. Turn **auto-renew on** for `bigbiteseasingwold.co.uk` at the registrar.
2. Check the card on file isn't about to expire.
3. Consider paying for **5–10 years up front**. It is a few pounds a year and it
   insures every menu, box and sign the shop ever prints.
4. **Never let this domain go**, even if the brand moves address later — keep it
   registered and redirect it. A printed QR code cannot be recalled.

## Regenerating

```sh
pip install segno
python3 make_qr.py        # plain codes
python3 make_branded.py   # with the bite mark in the centre
```

`make_qr.py` decodes its own output back and refuses to write a code that
doesn't read. The set committed here was additionally verified with two
independent decoders (zxing-cpp, which is the engine behind most phone camera
apps, and OpenCV) at 180 px, 240 px blurred, 400 px, 800 px and full size, and
rotated 12° — all pass.

Changing the URL means reprinting everything, so if the address ever changes,
redirect the old one rather than reissuing codes.
