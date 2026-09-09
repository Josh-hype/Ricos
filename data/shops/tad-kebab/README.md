# Tad Kebab (`tad-kebab`) — PRE-LAUNCH SCAFFOLD

Tadcaster takeaway: pizzas, kebabs, burgers. **Not live. Do not create the
Cloudflare project or point a domain at this until the blockers below are
cleared.**

Branding is done — `docs/brand/tad-kebab/` holds the vector kit, and `logo.png`
/ `icon.png` here are rendered from it. The theme in `config.json` uses the kit
palette, so the site already looks like the brand.

---

## What is real and what is not

| | State |
|---|---|
| Logo, icon, theme colours | **Real** — from the approved brand kit |
| Trading name, town | **Real** — confirmed with the owner |
| `menu.json` / `menu-visual.json` | **The template's dummy menu.** Mains/Sides/Drinks with invented prices. Nothing here came from the shop |
| Everything marked `TODO_` in `config.json` | Placeholder |
| Opening hours, delivery area, prep times | Untouched template defaults — **not** the shop's |
| `stripe.connectedAccountId` | Placeholder. Card payments will fail |

`npm run build` prints a warning listing the unfilled fields. That warning is
the gate: while it prints, this shop is not ready.

---

## Blockers, in the order they bite

1. **The menu.** The single biggest one. Every price the site charges comes from
   `menu.json` in pence, and no price here came from the shop. Get their actual
   menu — photos of the printed one are fine — before anything else.
2. **Business details.** Address, postcode, phone, orders email, domain, and
   the legal name / company number that the terms and privacy pages cite.
3. **Opening hours**, and how long before closing they want online orders to
   stop.
4. **Collection and delivery.** Whether they do both, the fee, the minimum
   order, and the area — which decides `outcode`, `radius` or `zones` mode.
5. **Stripe Connect onboarding**, which only they can complete. Until their
   `acct_…` is in, the site cannot take a card.

`docs/SHOP_INTAKE_FORM.md` asks for all of it in plain English — send them that
rather than assembling the questions again.

---

## When the data arrives

Follow `docs/SHOP_CHECKLIST.md` from Phase 2. Two things specific to this shop:

- **Every other Cloudflare project needs `data/shops/tad-kebab/*` adding to its
  Build watch path excludes.** Without it, a change to this shop rebuilds all
  five live sites.
- **Decide the product first.** LumiWEB (website + Z93) or LumiPOS (full till).
  It does not change the code — `docs/PRODUCTS.md` explains why — but it decides
  what hardware to order and what to bill.

The landing page is currently the generic `templates/landing-default.html`. A
bespoke `index.html` like Rico's or Big Bites needs their photography and copy,
so it is worth doing only once the shop is actually launching.
