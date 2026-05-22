/* Canonical menu — used both for server-side price calc and for the
   frontend (via /api/menu). Source of truth for prices.

   Prices in pence. mealAddP applies when the line opts into the meal
   upgrade on the order page.

   The active shop's menu is materialised at data/_active/menu.json by
   scripts/build-shop.js before each deploy, picked from
   data/shops/<SHOP_SLUG>/menu.json. Edit that file (not this one) to
   change prices, then redeploy. */
import MENU from '../../data/_active/menu.json';

export function getMenu() {
  return MENU;
}
