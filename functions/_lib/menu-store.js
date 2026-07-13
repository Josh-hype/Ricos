/* Runtime, owner-editable menu store.

   Menus normally live as two static files baked at build time:
     data/shops/<slug>/menu.json         (pricing truth, pence)
     data/shops/<slug>/menu-visual.json  (customer display, pounds)
   whose parity is enforced by scripts/build-shop.js::validateMenus.

   The Back-Office menu editor lets owners change the menu WITHOUT a redeploy.
   To do that safely we keep ONE unified menu document in KV (ORDERS_KV under
   the `setting:menu` key, via getSetting/putSetting) and DERIVE both the
   pricing and the display shapes from it. Because both shapes come from a
   single source, the price shown can never drift from the price charged — the
   whole class of bug the build's validateMenus guards against is impossible
   here by construction.

   Read paths:
     - resolveMenu(env)      -> pricing/server menu (KV override if set, else static)
     - resolveVisual(env, req)-> customer display menu (KV override if set, else the
                                 static /menu-visual.json asset, fetched internally)
   Write path (staff endpoint): validateUnified() then putSetting(env,'menu', json).

   The static files remain the safe fallback: with no override in KV, behaviour
   is byte-identical to today. */

import { getMenu } from './menu.js';
import { getSetting, putSetting } from './kv.js';

const KEY = 'menu';
const MAX_PRICE_P = 100000;      // £1000 sanity ceiling for any single price/delta
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/* ---------------------------------------------------------------- read ---- */

// The unified doc currently stored (parsed), or null if none / unreadable.
export async function getUnified(env) {
  try {
    const raw = await getSetting(env, KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw);
    return (doc && Array.isArray(doc.categories)) ? doc : null;
  } catch { return null; }
}

// Pricing/server menu (menu.json shape). KV override wins; else the static import.
export async function resolveMenu(env) {
  const doc = env ? await getUnified(env) : null;
  return doc ? deriveServerMenu(doc) : getMenu();
}

// Customer display menu (menu-visual.json shape). KV override wins; else the
// static asset, fetched from the same origin so we never bundle it server-side.
export async function resolveVisual(env, request) {
  const doc = env ? await getUnified(env) : null;
  if (doc) return deriveVisualMenu(doc);
  try {
    const res = await fetch(new URL('/menu-visual.json', request.url).toString(), { cf: { cacheTtl: 30 } });
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  return [];
}

/* -------------------------------------------------------------- derive ---- */

const p2f = (p) => Math.round(Number(p) || 0) / 100;   // pence -> pounds (display)

// Unified -> pricing/server menu (what totals.js indexes). Hidden items dropped.
export function deriveServerMenu(doc) {
  return (doc.categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    items: (c.items || []).filter((it) => !it.hidden).map((it) => {
      const out = { id: it.id, name: it.name, priceP: Math.round(it.priceP) || 0 };
      if (it.posOnly) out.posOnly = true;
      if (it.meal) {
        out.mealAddP = Math.round(it.meal.addP) || 0;
        out.mealChoose = (it.meal.choose || []).map(cleanChoose);
      }
      const mods = flattenModifiers(it.options);
      if (mods.length) out.modifiers = mods;
      return out;
    }),
  }));
}

// Unified -> customer display menu (what order.html renders). Hidden items dropped.
export function deriveVisualMenu(doc) {
  return (doc.categories || []).map((c) => {
    const cat = { id: c.id, name: c.name };
    if (c.icon) cat.icon = c.icon;
    cat.items = (c.items || []).filter((it) => !it.hidden).map((it) => {
      const out = { id: it.id, name: it.name, price: p2f(it.priceP) };
      if (it.desc) out.desc = it.desc;
      if (it.spicy) out.spicy = true;
      if (it.posOnly) out.posOnly = true;
      if (it.image) out.image = it.image;
      if (it.meal) {
        const meal = { label: it.meal.label || '+ meal', addPrice: p2f(it.meal.addP), choose: (it.meal.choose || []).map(cleanChoose) };
        if (it.meal.forced) meal.forced = true;
        if (it.meal.image) meal.image = it.meal.image;
        out.meal = meal;
      }
      if (Array.isArray(it.options) && it.options.length) {
        out.options = it.options.map((g) => {
          const grp = { id: g.id, label: g.label, select: g.select === 'single' ? 'single' : 'multi', required: !!g.required };
          if (Number.isFinite(g.min)) grp.min = g.min;
          if (Number.isFinite(g.max)) grp.max = g.max;
          if (g.whenMeal) grp.whenMeal = true;
          grp.choices = (g.choices || []).map((ch) => ({ id: ch.id, label: ch.label, price: p2f(ch.priceP) }));
          return grp;
        });
      }
      return out;
    });
    return cat;
  });
}

// menu-visual option groups -> flat menu.json modifiers (linked by choice id).
function flattenModifiers(options) {
  const out = [];
  for (const g of (options || [])) {
    for (const ch of (g.choices || [])) {
      const m = { id: ch.id, label: ch.label, priceDeltaP: Math.round(ch.priceP) || 0 };
      if (g.whenMeal) m.whenMeal = true;
      out.push(m);
    }
  }
  return out;
}

function cleanChoose(ch) {
  const out = { category: ch.category, label: ch.label || 'Choice', count: Math.max(1, Math.round(ch.count) || 1) };
  if (Array.isArray(ch.include) && ch.include.length) out.include = ch.include.slice();
  if (Array.isArray(ch.exclude) && ch.exclude.length) out.exclude = ch.exclude.slice();
  return out;
}

/* ------------------------------------------------- build initial unified -- */

// Merge the two static files into one unified doc for first-time editing.
// serverMenu = getMenu() (pricing); visual = the static menu-visual.json.
export function unifyStatic(serverMenu, visual) {
  const visCatById = new Map((visual || []).map((c) => [c.id, c]));
  return {
    version: 1,
    categories: (serverMenu || []).map((mc) => {
      const vc = visCatById.get(mc.id) || {};
      const visItemById = new Map((vc.items || []).map((i) => [i.id, i]));
      const cat = { id: mc.id, name: mc.name };
      if (vc.icon) cat.icon = vc.icon;
      cat.items = (mc.items || []).map((mi) => {
        const vi = visItemById.get(mi.id) || {};
        const it = { id: mi.id, name: mi.name, priceP: Math.round(mi.priceP) || 0 };
        if (vi.desc) it.desc = vi.desc;
        if (vi.spicy) it.spicy = true;
        if (mi.posOnly || vi.posOnly) it.posOnly = true;
        if (vi.image) it.image = vi.image;
        if (mi.mealChoose || (vi.meal && vi.meal.choose)) {
          const vm = vi.meal || {};
          it.meal = {
            label: vm.label || '+ meal',
            addP: Math.round(mi.mealAddP) || Math.round((vm.addPrice || 0) * 100) || 0,
            choose: (mi.mealChoose || vm.choose || []).map(cleanChoose),
          };
          if (vm.forced) it.meal.forced = true;
          if (vm.image) it.meal.image = vm.image;
        }
        // Prefer the visual option grouping (it carries labels/select); fall back
        // to reconstructing single groups from flat modifiers.
        if (Array.isArray(vi.options) && vi.options.length) {
          it.options = vi.options.map((g) => ({
            id: g.id, label: g.label, select: g.select === 'single' ? 'single' : 'multi',
            required: !!g.required,
            ...(Number.isFinite(g.min) ? { min: g.min } : {}),
            ...(Number.isFinite(g.max) ? { max: g.max } : {}),
            ...(g.whenMeal ? { whenMeal: true } : {}),
            choices: (g.choices || []).map((ch) => ({ id: ch.id, label: ch.label, priceP: Math.round((ch.price || 0) * 100) })),
          }));
        } else if (Array.isArray(mi.modifiers) && mi.modifiers.length) {
          it.options = [{
            id: mi.id + '-opts', label: 'Add', select: 'multi', required: false,
            choices: mi.modifiers.map((m) => ({ id: m.id, label: m.label, priceP: Math.round(m.priceDeltaP) || 0 })),
          }];
        }
        return it;
      });
      return cat;
    }),
  };
}

/* ------------------------------------------------------------ validate ---- */

// Returns { ok:true, doc } (normalised) or { ok:false, errors:[...] }.
export function validateUnified(input) {
  const errors = [];
  if (!input || !Array.isArray(input.categories) || input.categories.length === 0) {
    return { ok: false, errors: ['The menu must have at least one category.'] };
  }
  const catIds = new Set();
  const itemIds = new Set();
  const clean = { version: 1, updatedAt: null, categories: [] };

  const str = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
  const priceP = (v, field) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0) { errors.push(`${field}: price must be 0 or more.`); return 0; }
    if (n > MAX_PRICE_P) { errors.push(`${field}: price looks too high (max £${MAX_PRICE_P / 100}).`); return MAX_PRICE_P; }
    return n;
  };

  for (const c of input.categories) {
    const cid = str(c.id, 60).toLowerCase();
    const cname = str(c.name, 60);
    if (!SLUG_RE.test(cid)) { errors.push(`Category id "${c.id}" is invalid.`); continue; }
    if (!cname) { errors.push(`A category is missing a name.`); }
    if (catIds.has(cid)) { errors.push(`Duplicate category "${cid}".`); continue; }
    catIds.add(cid);
    const cat = { id: cid, name: cname, items: [] };
    if (c.icon) cat.icon = str(c.icon, 8);

    for (const it of (c.items || [])) {
      const id = str(it.id, 60).toLowerCase();
      const name = str(it.name, 120);
      if (!SLUG_RE.test(id)) { errors.push(`Item id "${it.id}" (in ${cname}) is invalid.`); continue; }
      if (!name) { errors.push(`An item in ${cname} is missing a name.`); }
      if (itemIds.has(id)) { errors.push(`Duplicate item id "${id}".`); continue; }
      itemIds.add(id);

      const out = { id, name, priceP: priceP(it.priceP, `Item "${name}"`) };
      if (it.desc) out.desc = str(it.desc, 400);
      if (it.spicy) out.spicy = true;
      if (it.hidden) out.hidden = true;
      if (it.posOnly) out.posOnly = true;
      if (typeof it.image === 'string' && it.image) out.image = it.image.slice(0, 800000);

      if (it.meal && typeof it.meal === 'object') {
        const choose = (Array.isArray(it.meal.choose) ? it.meal.choose : []).map((ch) => ({
          category: str(ch.category, 60).toLowerCase(),
          label: str(ch.label, 40) || 'Choice',
          count: Math.max(1, Math.min(20, Math.round(Number(ch.count)) || 1)),
          ...(Array.isArray(ch.include) && ch.include.length ? { include: ch.include.map((x) => str(x, 60).toLowerCase()) } : {}),
          ...(Array.isArray(ch.exclude) && ch.exclude.length ? { exclude: ch.exclude.map((x) => str(x, 60).toLowerCase()) } : {}),
        })).filter((ch) => ch.category);
        out.meal = { label: str(it.meal.label, 40) || '+ meal', addP: priceP(it.meal.addP, `Meal on "${name}"`), choose };
        if (it.meal.forced) out.meal.forced = true;
        if (typeof it.meal.image === 'string' && it.meal.image) out.meal.image = it.meal.image.slice(0, 800000);
      }

      if (Array.isArray(it.options) && it.options.length) {
        const choiceIds = new Set();
        out.options = it.options.map((g, gi) => {
          const gid = str(g.id, 60).toLowerCase() || `${id}-opt${gi}`;
          const grp = {
            id: SLUG_RE.test(gid) ? gid : `${id}-opt${gi}`,
            label: str(g.label, 60) || 'Options',
            select: g.select === 'single' ? 'single' : 'multi',
            required: !!g.required,
          };
          if (Number.isFinite(Number(g.min))) grp.min = Math.max(0, Math.round(Number(g.min)));
          if (Number.isFinite(Number(g.max))) grp.max = Math.max(1, Math.round(Number(g.max)));
          if (g.whenMeal) grp.whenMeal = true;
          grp.choices = (Array.isArray(g.choices) ? g.choices : []).map((ch, ci) => {
            let chid = str(ch.id, 60).toLowerCase();
            if (!SLUG_RE.test(chid)) chid = `${grp.id}-${ci}`;
            if (choiceIds.has(chid)) { errors.push(`Duplicate option id "${chid}" on "${name}".`); }
            choiceIds.add(chid);
            return { id: chid, label: str(ch.label, 60) || 'Option', priceP: priceP(ch.priceP, `Option "${str(ch.label, 30)}" on "${name}"`) };
          }).filter((ch) => ch.label);
          return grp;
        }).filter((g) => g.choices.length);
      }

      cat.items.push(out);
    }
    clean.categories.push(cat);
  }

  // Cross-references: every meal.choose category must exist.
  for (const c of clean.categories) {
    for (const it of c.items) {
      for (const ch of (it.meal?.choose || [])) {
        if (!catIds.has(ch.category)) errors.push(`"${it.name}" meal references unknown category "${ch.category}".`);
      }
    }
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 20) };
  return { ok: true, doc: clean };
}

// Turn a name into a stable, unique slug id given the ids already in use.
export function slugify(name, taken) {
  let base = String(name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  let id = base, n = 2;
  while (taken && taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export async function saveUnified(env, doc) {
  await putSetting(env, KEY, JSON.stringify(doc));
}

export async function clearUnified(env) {
  if (env.ORDERS_KV) await env.ORDERS_KV.delete('setting:' + KEY);
}
