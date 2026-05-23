# Food Station — shop folder (WORK IN PROGRESS)

Second shop on the platform. Brand sourced from the client's
"Food Station — Brand Identity Guide, Volume 01".

## Brand reference
- **Name:** Food Station (short: Food Station)
- **Cuisines:** pizza · parmo · kebab · burger · wrap ("five cravings")
- **Taglines:** "Every craving. One station." (lead/signage) ·
  "Five cravings. One kitchen. Zero compromises." (menu opener) ·
  "Pull up. Pig out." (social) · "Your hunger's last stop."
- **Palette:** Tomato Red `#D72C26` (primary) · Leaf Green `#4FAE3F`
  (secondary) · Mustard `#F2B91D` (accent) · Charcoal `#1A1A1A`
  (text/outlines) · Cream `#FBF5E9` (background — never pure white)
- **Type:** Poppins Bold (display/headlines) · Poppins Regular (body).
  Chunky sticker-style alt for signage: Lilita One / Bowlby One SC.
- **Voice:** a mate behind the counter — confident, a bit cheeky, warm,
  direct. Never corporate, never try-hard.
- **Per-category copy:**
  - Pizza — "Stone-baked, edge-to-edge topped, never shy on the cheese."
  - Parmo — "Pounded chicken breast, golden breadcrumb shell, smothered
    in bechamel and melted cheese."
  - Kebabs — "Chargrilled meat off the skewer, fresh salad, warm
    flatbread, sauce of your choice."
  - Burgers — "Smashed, seared, double-stacked. American cheese, soft
    brioche, no rubber-lettuce nonsense."
  - Wraps — "Loaded, rolled, foil-tucked. Built to eat one-handed."
- **Signature item:** "The Indecision Box". **Signature offer:** "The
  Station Stack" (any 2 mains + chips + drink; loyalty = 10 stacks free).

## Still needed before this builds / deploys
- [ ] **logo.png** — the Food Station logo (real tomato + bell-pepper
      photos as letterforms; must be supplied as a file — cannot be
      recreated as vector). Build script requires it to run.
- [ ] **Real menu** — taken exactly from the shop's foodbooking ordering
      page. `menu.json` + `menu-visual.json` currently hold the
      `_template` placeholder items.
- [ ] **Operational details** — address, phone, orders email, domain,
      opening hours, delivery area / fee / minimum (config.json has
      `TODO_` markers). Collect via `docs/SHOP_INTAKE_FORM.md`.
- [ ] **Custom landing** `index.html` — branded landing using the
      palette + taglines (optional; falls back to the default template).
- [ ] **Stripe Connect** `acct_` for live payments (go-live).
