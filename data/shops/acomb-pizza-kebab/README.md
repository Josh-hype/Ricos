# Acomb Pizza & Kebab House (`acomb-pizza-kebab`)

**LumiWEB** customer — website + web back office, ZCS Z93 on the counter.
£19/wk. See `docs/PRODUCTS.md`.

**Status: pre-launch scaffold.** This folder does **not** build yet — `logo.png`
is required and isn't here. That's expected; upload the files below and it will.

---

## Where to upload what

| Put it here | What it is |
|---|---|
| **`reference/`** | **The landing-page design visual(s)** — the picture the site has to end up looking like. PNG or JPG. Name them `landing-desktop.png`, `landing-mobile.png` if you have both. **Not shipped** — the build ignores this folder, it exists so the design loop can read it. |
| **`assets/`** | **Every photo/graphic the design uses** — hero shot, food photos, textures, badges. **Flat files only, no sub-folders** (the build skips sub-directories and warns). These are copied to `/assets/<filename>` on the live site. |
| **`logo.png`** | The logo. **Required — the build fails without it.** |
| **`icon.png`** *(optional)* | A **square** icon for the browser tab. Worth adding if the logo is wide, which letterboxes badly at favicon size. |

Then run the design loop — see `tools/design-loop/README.md`:

```bash
node tools/design-loop/render.mjs acomb-pizza-kebab     # build + screenshot
```

…and the agent loop drives it from there until the page matches `reference/`.

---

## Still needed before this can go live

Everything marked `TODO_` in `config.json` — the build prints each one as a
warning on every run, so nothing here can be forgotten silently:

- [ ] Legal name + Companies House number
- [ ] Address line 1 + postcode
- [ ] Phone, orders email, domain
- [ ] Real opening hours (currently the template's 12:00–22:00 every day)
- [ ] Delivery: `outcode` or `radius`, the area, the fees, the minimum order
- [ ] `stripe.connectedAccountId` — a real `acct_…`. **Card payments fail until
      this is set**, and the build says so loudly.
- [ ] `menu.json` + `menu-visual.json` — still the template's two example items.
      Prices are **pence** in `menu.json`, **pounds** in `menu-visual.json`, and
      the item ids must match exactly.
- [ ] Brand colours in `config.theme` — deliberately still Rico's red. The design
      loop sets these from the reference visual; don't hand-pick them first.

Then the Cloudflare project, KV namespaces, secrets and domain — follow
`docs/SHOP_CHECKLIST.md`, and don't forget to add
`data/shops/acomb-pizza-kebab/*` to **every other project's** build-watch
Exclude paths, or a change here rebuilds all of them.
