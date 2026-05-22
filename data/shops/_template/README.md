# `_template/` — starter shop folder

Copy this folder to spin up a new shop:

```bash
cp -r data/shops/_template data/shops/<your-slug>
```

Then edit:

- `config.json` — business info, theme colours, hours, delivery zone,
  Stripe Connect ID
- `menu.json` — canonical menu with prices in pence (server-side source
  of truth)
- `menu-visual.json` — customer-facing menu (names, descriptions, photos)
- Add `logo.png` — the shop's logo (PNG, ideally square, transparent)
- Optionally add `index.html` — bespoke landing page. Omit to use the
  generic default from `templates/landing-default.html`.

Full step-by-step (including Cloudflare setup, KV namespaces, Stripe
Connect, custom domain) is in [`docs/ADDING_A_SHOP.md`](../../../docs/ADDING_A_SHOP.md).

The build script rejects slugs that start with underscore, so this
folder can't be used as an active shop by accident.
