# The reference sheets

`outer.png` and `inner.png` are the two faces of the **owner-supplied,
ChatGPT-generated** trifold. They are the target this menu is matched
against — every layout decision in `build-menu.mjs` traces back to one of
them, so they are committed rather than kept in a scratch directory.

They are a **design reference, not a source of truth for content.** The
artwork carries several factual errors that are corrected here on purpose;
`../README.md` ("Errors this replaced") lists them. The one to remember:
the phone number on these sheets is **824522**, which is the old Food
Station line. The real number is **820820**.

Judging the generated sheet against these: normalise both to a common
width first (they are 1491x1055 and 1492x1054, the render is 4262x3031),
and exclude the 3mm bleed, the deliberately empty asset slots, and the
corrections listed above.
