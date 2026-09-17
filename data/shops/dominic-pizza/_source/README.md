# Upload Dominic Pizza's source material here

Anything dropped in this folder is **ignored by the build** — `build-shop.js`
only reads named files (`config.json`, `menu.json`, `menu-visual.json`,
`logo.png`, `icon.png`, `index.html`, `order.css`) plus flat files in `assets/`.
So photos of menus, original logo artwork and reference visuals can sit here
safely without being published. Same convention as `data/shops/leaf-cafe/_source`.

## What's wanted

| File | What it is |
|---|---|
| `menu-1.jpg`, `menu-2.jpg`, … | **Photos or a PDF of the printed menu.** Flat-on, whole page in frame, prices legible. Several photos beat one wide shot. |
| `logo.*` | The logo — PNG/SVG/PDF ideally, but a photo of the shopfront, a business card or the menu header works; it can be cut out. |
| `food/*.jpg` *(optional)* | Dish photos. Only worth it if they're good; the inherited stock shots are decent. |

Once the menu is here it gets turned into `menu.json` (prices in **pence**,
server source of truth) and `menu-visual.json` (customer-facing, prices in
pounds), with **identical item IDs** in both — the build fails if they drift.

The 141 items currently in those two files are Acomb Pizza & Kebab House's,
inherited when this folder was copied. They are placeholders.
