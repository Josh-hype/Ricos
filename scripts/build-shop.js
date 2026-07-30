#!/usr/bin/env node
/* Multi-tenant build step.

   Cloudflare Pages runs this before deploying each Pages project. The
   project's SHOP_SLUG environment variable picks which subfolder of
   data/shops/<slug>/ becomes the "active" set of config + assets for
   this deploy:

     data/shops/<slug>/config.json      -> data/_active/config.json
     data/shops/<slug>/menu.json        -> data/_active/menu.json
     data/shops/<slug>/menu-visual.json -> public/menu-visual.json
     data/shops/<slug>/logo.png         -> public/logo.png

   menu-visual.json goes into public/ (not data/_active/) so it's served
   as a static CDN asset rather than embedded in the Cloudflare Functions
   bundle. The visual menu can be megabytes of base64 photos and would
   eat the 3MB compressed Worker size budget otherwise.

   Server-side imports (functions/_lib/config.js etc.) always read
   from data/_active/, which is rebuilt per deploy.
   public/logo.png is overwritten in place so the email + page logo
   URL stays stable across shops.

   After copying, the script substitutes {{token}} placeholders inside
   the templated HTML / manifest files in public/ with values derived
   from the active shop's config.json. Run via `npm run build` (which
   is wired into the dev and deploy scripts in package.json).

   Run with SHOP_SLUG=<slug> (defaults to "ricos" so local dev works
   without env setup). */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// Reuse the REAL table normaliser the API and till use, so the deploy warning
// below can't disagree with what actually renders on the device.
import { normalizeTables } from '../functions/_lib/tables.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

/* Cross-check the dual menu files. Pure (no I/O) so it's easy to reason about and
   test. Returns { errors, warnings }; the caller fails the build on errors. */
function validateMenus(menu, visual) {
  const errors = [], warnings = [];
  const index = (arr) => {
    const first = new Map(), dupes = new Map();
    for (const cat of arr || []) for (const it of cat.items || []) {
      if (!first.has(it.id)) first.set(it.id, it);
      dupes.set(it.id, [...(dupes.get(it.id) || []), it]);
    }
    return { first, dupes };
  };
  const m = index(menu), v = index(visual);

  for (const id of m.first.keys()) if (!v.first.has(id)) errors.push(`item "${id}" is in menu.json but not menu-visual.json`);
  for (const id of v.first.keys()) if (!m.first.has(id)) errors.push(`item "${id}" is in menu-visual.json but not menu.json`);

  const dupeCheck = (dupes, file) => {
    for (const [id, list] of dupes) if (list.length > 1) {
      const identical = list.every(x => JSON.stringify(x) === JSON.stringify(list[0]));
      (identical ? warnings : errors).push(`${file} item "${id}" appears ${list.length}× (${identical ? 'identical cross-listing' : 'DIFFERING copies — they will silently diverge'})`);
    }
  };
  dupeCheck(m.dupes, 'menu.json');
  dupeCheck(v.dupes, 'menu-visual.json');

  for (const [id, vi] of v.first) {
    const mi = m.first.get(id);
    if (!mi) continue;
    if (typeof vi.price === 'number' && typeof mi.priceP === 'number' && Math.round(vi.price * 100) !== mi.priceP) {
      errors.push(`"${id}" base price: menu-visual £${vi.price} (=${Math.round(vi.price * 100)}p) != menu.json ${mi.priceP}p`);
    }
    const mods = new Map((mi.modifiers || []).map(x => [x.id, x]));
    const used = new Set();
    for (const opt of vi.options || []) {
      for (const ch of opt.choices || []) {
        const priceP = Math.round((Number(ch.price) || 0) * 100);
        const mod = mods.get(ch.id);
        if (!mod) {
          if (priceP > 0) errors.push(`"${id}" option "${opt.id}" choice "${ch.id}" costs £${ch.price} but has NO matching modifier in menu.json (server would drop it → undercharge)`);
          else warnings.push(`"${id}" option "${opt.id}" choice "${ch.id}" (£0) has no menu.json modifier — the order/ticket loses its label`);
          continue;
        }
        used.add(ch.id);
        // Size-priced modifiers vary by the selected size; skip the strict flat check.
        if (mod.priceDeltaPBySize) continue;
        const flat = Number(mod.priceDeltaP) || 0;
        if (flat !== priceP) errors.push(`"${id}" choice "${ch.id}": menu-visual £${ch.price} (=${priceP}p) != modifier priceDeltaP ${flat}p`);
      }
    }
    for (const mod of mi.modifiers || []) {
      if (!used.has(mod.id) && !mod.whenMeal && !mod.priceDeltaPBySize) {
        warnings.push(`"${id}" modifier "${mod.id}" is not referenced by any menu-visual choice`);
      }
    }
  }
  return { errors, warnings };
}

/* ---------- Lumin Labs platform admin build ----------
   The owner back-office is its OWN Cloudflare Pages project off this same repo,
   selected by PLATFORM_BUILD=1 (NOT a SHOP_SLUG). It is not a shop — no menu, no
   storefront, no order page. We still write minimal data/_active stubs so the
   shared functions bundle (which statically imports data/_active/{config,menu}.json)
   compiles, then publish ONLY the admin dashboard as public/index.html and stop.
   Runs before any shop logic so the slug rules never apply to it. */
if (/^(1|true|yes)$/i.test((process.env.PLATFORM_BUILD || '').trim())) {
  const activeDir = path.join(repoRoot, 'data', '_active');
  const publicDir = path.join(repoRoot, 'public');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  // Inert stub config + empty menu so config.js / menu.js resolve on the admin
  // project (it never serves a storefront; stripeEnabled:false makes that explicit).
  fs.writeFileSync(path.join(activeDir, 'config.json'), JSON.stringify({
    _platformAdmin: true,
    business: { tradingName: 'Lumin Labs', shortName: 'Lumin Labs', address: {} },
    theme: {}, fulfillment: { collection: {}, delivery: {} },
    payments: { stripeEnabled: false }, pos: {}, ordering: {}, promo: {},
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(activeDir, 'menu.json'), '[]\n');

  const tpl = path.join(repoRoot, 'templates', 'admin', 'index.html');
  if (!fs.existsSync(tpl)) {
    console.error('build-shop: PLATFORM_BUILD set but templates/admin/index.html is missing.');
    process.exit(1);
  }
  // Externalise the page's inline <script> so it runs under the strict CSP
  // (script-src 'self') from _middleware.js — same technique as the shop build.
  let html = fs.readFileSync(tpl, 'utf8');
  let n = 0;
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_m, body) => {
    const rel = `admin.inline${n}.js`;
    fs.writeFileSync(path.join(publicDir, rel), body);
    n++;
    return `<script src="/${rel}"></script>`;
  });
  fs.writeFileSync(path.join(publicDir, 'index.html'), html);

  // Hidden console: keep it out of search engines (overrides the shop /* header).
  fs.writeFileSync(path.join(publicDir, '_headers'),
    '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: no-store, must-revalidate\n\n/api/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n');
  fs.writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');

  console.log(`build-shop: PLATFORM_BUILD -> public/index.html (Lumin Labs owner console, ${n} script(s) externalised)`);
  console.log('build-shop: active shop is "_platform" (Lumin Labs admin).');
  process.exit(0);
}

// Shop selection: each Cloudflare Pages project sets its own SHOP_SLUG env
// var (for both Production and Preview). "ricos" is only a local-dev fallback
// so `npm run build` works without env setup.
const rawSlug = (process.env.SHOP_SLUG || '').trim();
// "ricos" is the historical default: the original Rico's Pages project predates
// the SHOP_SLUG env var and relies on this fallback. WARN loudly (don't fail) if
// it's unset in a CI/Pages build — a NON-Rico's project should set SHOP_SLUG
// (Production AND Preview) so it can't accidentally build Rico's under its own
// domain — but failing here would break the Rico's project's deploys.
if (!rawSlug && (process.env.CF_PAGES || process.env.CI)) {
  console.warn('⚠️  build-shop: SHOP_SLUG is not set in a CI/Pages build — defaulting to "ricos". If this is NOT the Rico\'s project, set SHOP_SLUG on it (Production AND Preview).');
}
const slug = rawSlug || 'ricos';
const shopDir = path.join(repoRoot, 'data', 'shops', slug);

if (slug.startsWith('_')) {
  console.error(`build-shop: shop slug "${slug}" starts with underscore. Underscore-prefixed folders (e.g. _template) are scaffolding, not deployable shops. Choose a real slug.`);
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`build-shop: invalid shop slug "${slug}". Use lowercase letters, digits and dashes only (e.g. pizza-bob) — no slashes or dots.`);
  process.exit(1);
}
if (!fs.existsSync(shopDir)) {
  console.error(`build-shop: no shop folder at data/shops/${slug}. Set SHOP_SLUG correctly or create the folder (copy data/shops/_template/ as a starting point).`);
  process.exit(1);
}

const activeDir = path.join(repoRoot, 'data', '_active');
fs.mkdirSync(activeDir, { recursive: true });

const copies = [
  // [from inside shop folder, to inside repo]
  ['config.json',      'data/_active/config.json'],
  ['menu.json',        'data/_active/menu.json'],
  ['logo.png',         'public/logo.png'],
  // menu-visual.json is handled separately below (base64 image extraction).
];

for (const [src, dest] of copies) {
  const from = path.join(shopDir, src);
  const to = path.join(repoRoot, dest);
  if (!fs.existsSync(from)) {
    console.error(`build-shop: missing data/shops/${slug}/${src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`build-shop: ${slug}/${src} -> ${dest}`);
}

// Optional card-reader splash background. The staff "Card Reader" screen composites the
// shop logo over it for the WisePOS E idle screen; omitted shops just use a white canvas.
for (const bg of ['reader-bg.jpg', 'reader-bg.png']) {
  const from = path.join(shopDir, bg);
  if (fs.existsSync(from)) {
    const ext = bg.slice(bg.lastIndexOf('.'));
    fs.copyFileSync(from, path.join(repoRoot, 'public', 'reader-bg' + ext));
    console.log(`build-shop: ${slug}/${bg} -> public/reader-bg${ext}`);
    break;
  }
}

// Favicon source. Google (and browser tabs) show a site's favicon; with none
// declared it falls back to a generic globe. A shop can drop a SQUARE icon.png
// in its folder to use as the favicon (recommended when logo.png is wide/
// rectangular, which letterboxes badly at favicon size). Otherwise we fall back
// to logo.png, which is ideal for the square badge-style logos.
const shopIcon = path.join(shopDir, 'icon.png');
const hasShopIcon = fs.existsSync(shopIcon);
const publicIcon = path.join(repoRoot, 'public', 'icon.png');
if (hasShopIcon) {
  fs.copyFileSync(shopIcon, publicIcon);
  console.log(`build-shop: ${slug}/icon.png -> public/icon.png`);
} else if (fs.existsSync(publicIcon)) {
  fs.rmSync(publicIcon); // clear a stale icon.png from a previous local build
}
const faviconHref = hasShopIcon ? '/icon.png' : '/logo.png';

/* menu-visual.json: pull any inline base64 images out into separate, cacheable
   files and rewrite the JSON to reference them by URL. A photo-heavy menu can be
   2-3MB of base64 inline, and the order page must download the whole thing before
   it can render — slow first paint, and re-downloaded every visit (the JSON is
   served no-store). Extracting the images drops the JSON to tens of KB (fast
   render) and lets the photos load lazily and cache immutably under
   /assets/menu/ (hashed filenames, so they cache-bust only when changed). */
{
  const srcMenu = path.join(shopDir, 'menu-visual.json');
  if (!fs.existsSync(srcMenu)) {
    console.error(`build-shop: missing data/shops/${slug}/menu-visual.json`);
    process.exit(1);
  }
  const menuImgDir = path.join(repoRoot, 'public', 'assets', 'menu');
  const written = new Set();

  function extractImage(dataUri) {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/is.exec(dataUri);
    if (!m) return dataUri; // non-base64 data URI (e.g. svg+utf8) — leave inline
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const name = `menu-${hash}.${ext}`;
    if (!written.has(name)) {
      fs.mkdirSync(menuImgDir, { recursive: true });
      fs.writeFileSync(path.join(menuImgDir, name), buf);
      written.add(name);
    }
    return `/assets/menu/${name}`;
  }
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(node)) o[k] = walk(v);
      return o;
    }
    if (typeof node === 'string' && node.startsWith('data:image/')) return extractImage(node);
    return node;
  }

  const rewritten = walk(JSON.parse(fs.readFileSync(srcMenu, 'utf8')));
  const outMenu = path.join(repoRoot, 'public', 'menu-visual.json');
  fs.mkdirSync(path.dirname(outMenu), { recursive: true });
  const json = JSON.stringify(rewritten);
  fs.writeFileSync(outMenu, json);
  console.log(`build-shop: ${slug}/menu-visual.json -> public/menu-visual.json (${written.size} image(s) extracted, ${(json.length / 1024).toFixed(0)}KB JSON)`);
}

/* Menu invariant check (CLAUDE.md's "dual file, linked by id"). Nothing else
   enforces it, and drift silently mis-prices or drops options. We FAIL the build
   on the dangerous cases and WARN on the benign ones:
     ERROR — an item id on only one side; a base-price mismatch (visual £ vs
             menu pence); a priced option choice with no matching modifier (the
             client shows +£X but the server drops it → undercharge); a modifier
             priceDeltaP that disagrees with its visual choice; a duplicate item
             id whose copies DIFFER.
     WARN  — a £0 choice with no modifier (only the ticket label is lost); an
             identical duplicate id (an intentional cross-listing); a plain
             modifier no visual choice references. */
{
  const menu = JSON.parse(fs.readFileSync(path.join(shopDir, 'menu.json'), 'utf8'));
  const visual = JSON.parse(fs.readFileSync(path.join(shopDir, 'menu-visual.json'), 'utf8'));
  const { errors, warnings } = validateMenus(menu, visual);
  for (const w of warnings) console.warn(`build-shop: menu warning [${slug}]: ${w}`);
  if (errors.length) {
    console.error(`\n❌ build-shop: "${slug}" menu.json ↔ menu-visual.json invariant violations:`);
    for (const e of errors) console.error(`     - ${e}`);
    console.error('   Fix the shop data (prices in menu.json are pence, menu-visual.json are pounds; ids must match).\n');
    process.exit(1);
  }
  console.log(`build-shop: menu invariant check passed (${warnings.length} warning(s)).`);
}

/* Per-shop static assets (food photos etc.): copy data/shops/<slug>/assets/*
   to public/assets/. Optional — shops without an assets/ folder skip this. */
{
  const shopAssets = path.join(shopDir, 'assets');
  if (fs.existsSync(shopAssets)) {
    const outAssets = path.join(repoRoot, 'public', 'assets');
    fs.mkdirSync(outAssets, { recursive: true });
    for (const f of fs.readdirSync(shopAssets)) {
      const srcFile = path.join(shopAssets, f);
      if (!fs.statSync(srcFile).isFile()) {
        console.warn(`build-shop: skipping non-file asset ${slug}/assets/${f} (sub-directories aren't copied).`);
        continue;
      }
      fs.copyFileSync(srcFile, path.join(outAssets, f));
      console.log(`build-shop: ${slug}/assets/${f} -> public/assets/${f}`);
    }
  }
}

/* ---------- Template substitution ---------- */

const config = JSON.parse(fs.readFileSync(path.join(activeDir, 'config.json'), 'utf8'));

// Loud pre-deploy warnings for un-filled scaffold values. These don't fail the
// build (a shop can put its info pages live before payments are wired up), but
// they must be impossible to miss in the deploy log.
{
  const warns = [];
  const acct = config.stripe?.connectedAccountId || '';
  if (!acct || /REPLACE|TODO/i.test(acct)) {
    warns.push(`stripe.connectedAccountId is a placeholder ("${acct}") — CARD PAYMENTS WILL FAIL.`);
  }
  const biz = config.business || {};
  for (const [k, v] of Object.entries({ legalName: biz.legalName, companyNumber: biz.companyNumber, email: biz.email, domain: biz.domain })) {
    if (typeof v === 'string' && /TODO|REPLACE/i.test(v)) warns.push(`business.${k} is still a placeholder ("${v}").`);
  }
  // A hospitality shop with no usable tables ships a till whose Eat in button
  // dead-ends ("No tables are set up for this shop yet.") — staff can't take a
  // dine-in order at all. Easy to cause by mis-keying the array, and otherwise
  // silent, so say so loudly in the deploy log.
  const pos = config.pos || {};
  if (pos.serviceStyle === 'hospitality') {
    const listed = Array.isArray(pos.tables) ? pos.tables.length : 0;
    const usable = normalizeTables(pos.tables).length;
    if (usable === 0) {
      warns.push('pos.serviceStyle is "hospitality" but pos.tables has no usable entries — the till\'s "Eat in" will dead-end. Check the key name and that each entry has a label.');
    } else if (usable < listed) {
      warns.push(`pos.tables lists ${listed} entries but only ${usable} are usable (blank labels or duplicate ids are dropped) — the table grid will show ${usable}.`);
    }
  }
  if (warns.length) {
    console.warn(`\n⚠️  build-shop: "${slug}" has unfilled config:`);
    for (const w of warns) console.warn(`     - ${w}`);
    console.warn('');
  }
}

// Optional per-shop CSS appended to the order page's <style> block. Lets a
// shop layer on bespoke styling (e.g. Food Station's sticker buttons) without
// forking the shared template. Absent for most shops -> empty -> no change.
const orderCssFile = path.join(shopDir, 'order.css');
const orderStyleOverrides = fs.existsSync(orderCssFile)
  ? fs.readFileSync(orderCssFile, 'utf8')
  : '';

const a = config.business.address || {};
const phone = config.business.phone || '';
const phoneTel = phone.replace(/\s+/g, '');
const fullAddress = [a.line1, a.city, a.postcode].filter(Boolean).join(', ');
// Derive postcode area prefix (the letter prefix before the digits) from the
// shop's own postcode: "YO24 1AZ" -> "YO", "LS1 4DT" -> "LS", "M1 1AA" -> "M".
const areaPrefix = (a.postcode || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';

// Legal pages (privacy / terms / allergy-info). Some shops haven't supplied a
// registered company or contact email yet (placeholders like "TODO_..."); treat
// those as absent and fall back gracefully so the pages still read correctly.
const isSet = (v) => v && !/^TODO[_-]|REPLACE_WITH/i.test(String(v).trim());
const legalName     = isSet(config.business.legalName)     ? String(config.business.legalName).trim()     : '';
const companyNumber = isSet(config.business.companyNumber) ? String(config.business.companyNumber).trim() : '';
const email         = isSet(config.business.email)         ? String(config.business.email).trim()         : '';

// One clause identifying the legal entity / data controller for the legal pages.
let controllerIdentity;
if (legalName && companyNumber) {
  controllerIdentity = `${legalName} (company number ${companyNumber}), a company registered in England and Wales, trading as ${config.business.tradingName} from ${fullAddress}`;
} else if (legalName) {
  controllerIdentity = `${legalName}, trading as ${config.business.tradingName}, of ${fullAddress}`;
} else {
  controllerIdentity = `${config.business.tradingName}, of ${fullAddress}`;
}

// How customers reach us on the legal pages: THE PHONE ONLY, for every shop.
// Owner decision 2026-07-30. These are takeaways — they answer the phone all
// evening and nobody watches an inbox, so an email address here is a contact
// route that goes nowhere. This line is the data-controller contact on
// privacy.html (right next to the ICO complaint route) and on terms.html and
// allergy-info.html, so it has to be a channel the shop actually answers: a
// phone number satisfies that, an unmonitored mailbox does not.
// business.email is still published via /api/config and is still available to
// landing pages as {{shopEmail}} — it is only kept off the legal pages.
// The fallback covers a shop with no phone set (today: one-sip, which is
// till-only and has no customer site).
const contactLine = phone
  ? `by phone on ${phone}`
  : 'using the contact details on our website';

// Terms: the promotional-discount clause only appears for shops that run one.
const promo = config.promo?.autoOnlineDiscount;
const promoSection = (promo && promo.enabled)
  ? `<h2>Promotional discounts</h2>\n    <p>The ${promo.percent}% online discount is applied automatically to the subtotal of qualifying online orders. We may change or end this offer at any time.</p>`
  : '';

// First-orders welcome offer: a landing-page banner + a plain-text sentence,
// emitted only when the shop runs it (config.promo.firstOrders.enabled). The
// banner is a config-gated token so it ships to every landing template but only
// renders where the offer is on — turning it off in config makes it vanish on
// the next build. Colours come from the shop theme so it matches the brand.
const firstOrders = config.promo?.firstOrders;
const firstOrdersOn = !!(firstOrders && firstOrders.enabled);
const firstOrdersLimit = Number(firstOrders?.limit) || 0;
const firstOrdersPct = Number(firstOrders?.percent) || 0;
// "first order" reads better than "first 1 order"; drop the count when it's 1.
const firstNOrders = firstOrdersLimit === 1 ? 'order' : `${firstOrdersLimit} orders`;
const firstOrderPromoText = firstOrdersOn
  ? `${firstOrdersPct}% off your first ${firstNOrders}`
  : '';
const foBg = config.theme?.accent || '#f5b71e';
const foFg = config.theme?.primaryDeep || config.theme?.primaryDark || '#1a1a1a';
const firstOrderPromoBanner = firstOrdersOn
  ? `<div class="promo-flash" role="note" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;text-align:center;background:${foBg};color:${foFg};font-weight:800;letter-spacing:.01em;padding:11px 18px;font-size:clamp(.95rem,2.4vw,1.1rem);line-height:1.3;">`
    + `<span>🎉 New here? Get <strong>${firstOrderPromoText}</strong></span>`
    + `<a href="/order" style="color:${foFg};text-decoration:underline;text-underline-offset:3px;font-weight:800;white-space:nowrap;">Sign up &amp; order →</a>`
    + `</div>`
  : '';
// A round "sticker" seal for the hero — big % OFF the customer can't miss.
// Styling lives in the landing page (.promo-seal); this only emits the element
// (empty when the offer is off) with the shop's real numbers.
const firstOrderPromoBadge = firstOrdersOn
  ? `<div class="promo-seal" role="img" aria-label="${firstOrderPromoText}">`
    + `<span class="promo-seal-pct">${firstOrdersPct}%</span>`
    + `<span class="promo-seal-off">OFF</span>`
    + `<span class="promo-seal-bot">first ${firstNOrders}</span>`
    + `</div>`
  : '';

// SEO <head> block for the landing page: a JSON-LD Restaurant schema (so Google
// can confidently tie this domain to the business — name, address, hours, phone,
// menu, cuisine) plus a canonical link and Open Graph / Twitter tags. Built from
// config so every shop gets correct structured data; injected via {{seoHead}}.
function buildSeoHead() {
  const b = config.business || {};
  const seo = config.seo || {};
  const domain = b.domain || '';
  const url = `https://${domain}/`;
  const img = `${url}logo.png`;
  const name = b.tradingName || '';
  const desc = seo.description || `${name} — order online for collection or delivery in ${a.city || ''}.`;
  const DAYS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };
  // "25:00" (after-midnight close) → "01:00"; everything else stays HH:MM.
  const fixTime = (t) => { const [h, m] = String(t).split(':').map(Number); return String(((h % 24) + 24) % 24).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0'); };
  const openingHoursSpecification = [];
  const hours = config.hours || {};
  for (const k of Object.keys(DAYS)) {
    const d = hours[k];
    if (!d || d.closed || !Array.isArray(d.windows)) continue;
    for (const w of d.windows) openingHoursSpecification.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS[k], opens: fixTime(w.open), closes: fixTime(w.close) });
  }
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name, url, image: img,
    ...(phone ? { telephone: phone } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: a.line1 || '',
      addressLocality: a.city || '',
      ...(seo.addressRegion ? { addressRegion: seo.addressRegion } : {}),
      postalCode: a.postcode || '',
      addressCountry: 'GB',
    },
    ...(Array.isArray(seo.cuisine) && seo.cuisine.length ? { servesCuisine: seo.cuisine } : {}),
    ...(seo.priceRange ? { priceRange: seo.priceRange } : {}),
    menu: `${url}order`,
    acceptsReservations: false,
    ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
    ...(Array.isArray(seo.sameAs) && seo.sameAs.length ? { sameAs: seo.sameAs } : {}),
  };
  // Escape "<" so the JSON can never break out of the <script> tag.
  const jsonLd = JSON.stringify(schema).replace(/</g, '\\u003c');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(name)}" />`,
    `<meta property="og:title" content="${esc(name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(name)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n');
}

const tokens = {
  shopName:                config.business.tradingName || '',
  shopShortName:           config.business.shortName || config.business.tradingName || '',
  // Shop slug (folder name). Used to namespace per-shop client state such as
  // the localStorage cart key, so two shops never share a basket in the same
  // browser. For ricos this resolves to "ricos" (key unchanged).
  shopSlug:                slug,
  shopCity:                a.city || '',
  shopAddressLine1:        a.line1 || '',
  shopPostcode:            a.postcode || '',
  shopFullAddress:         fullAddress,
  shopPhone:               phone,
  shopPhoneTel:            phoneTel,
  shopAreaPrefix:          areaPrefix,
  shopDomain:              config.business.domain || '',
  deliveryAreaDescription: config.fulfillment?.delivery?.areaDescription || 'in our delivery area',
  // JSON literal for the allowed outcodes - injected into client JS so
  // postcode validation has a baseline before /api/config arrives.
  allowedOutcodesJSON:     JSON.stringify(config.fulfillment?.delivery?.allowedOutcodes || []),
  // Theme colours - inlined into the CSS :root blocks so the brand renders
  // correctly on the very first paint, before any JS runs.
  themePrimary:            config.theme?.primary     || '#c8261c',
  themePrimaryDark:        config.theme?.primaryDark || '#a01910',
  themePrimaryDeep:        config.theme?.primaryDeep || '#7d1208',
  themeAccent:             config.theme?.accent      || '#f5b71e',
  themeAccentDeep:         config.theme?.accentDeep  || '#d99a00',
  themeBackground:         config.theme?.background  || '#fff5d8',
  themeSurface:            config.theme?.surface     || '#fffaeb',
  // PWA chrome colour for the staff manifest theme_color. Defaults to Rico's
  // dark so its manifest is unchanged; other shops can set theme.chrome.
  themeChrome:             config.theme?.chrome      || '#181210',
  // Typography - the Google Fonts stylesheet URL plus the four font-family
  // stacks used as CSS custom properties on the order page. Defaults are
  // Rico's original faces, so any shop that omits a theme.fonts block (and
  // Rico's itself) renders byte-identically to before this was tokenised.
  fontLink:                config.theme?.fonts?.link        || 'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Caveat:wght@500;700&family=DM+Sans:wght@400;500;700&display=swap',
  fontDisplay:             config.theme?.fonts?.display      || "'Archivo Black', 'Arial Black', sans-serif",
  fontDisplayAlt:          config.theme?.fonts?.displayAlt   || "'Anton', 'Impact', sans-serif",
  fontBody:                config.theme?.fonts?.body         || "'DM Sans', system-ui, sans-serif",
  fontHand:                config.theme?.fonts?.hand         || "'Caveat', cursive",
  // Optional per-shop CSS injected at the end of the order page <style>.
  orderStyleOverrides,
  // Legal pages (privacy / terms / allergy-info).
  shopEmail:               email,
  shopLegalName:           legalName,
  shopCompanyNumber:       companyNumber,
  controllerIdentity,
  contactLine,
  promoSection,
  // First-orders welcome offer: a ready-to-drop landing banner + a round hero
  // seal (both empty when the offer is off) and the plain-text version for
  // bespoke landing copy / meta.
  firstOrderPromoBanner,
  firstOrderPromoBadge,
  firstOrderPromoText,
  // SEO meta sentence — only advertises the discount for shops that run it.
  promoTagline:            (promo && promo.enabled) ? ` ${promo.percent}% off all online orders.` : '',
  // Landing-page SEO <head>: JSON-LD Restaurant schema + canonical + OG/Twitter.
  seoHead:                 buildSeoHead(),
};

// Source HTML / manifest files with {{tokens}}. The build reads each from
// templates/ and writes the substituted version to public/ (deploy target).
// Add new files here when extracting more brand strings.
const templatedFiles = [
  // [source under templates/, destination under public/]
  ['order.html',            'public/order.html'],
  ['thank-you.html',        'public/thank-you.html'],
  ['reset-password.html',   'public/reset-password.html'],
  ['staff/index.html',      'public/staff/index.html'],
  ['staff/manifest.json',   'public/staff/manifest.json'],
  ['privacy.html',          'public/privacy.html'],
  ['terms.html',            'public/terms.html'],
  ['allergy-info.html',     'public/allergy-info.html'],
];

const tokenPattern = /\{\{(\w+)\}\}/g;

// Escape a value for safe interpolation INSIDE a JSON string literal — the
// template supplies the surrounding quotes, so strip JSON.stringify's pair.
function jsonStringEscape(s) {
  return JSON.stringify(String(s)).slice(1, -1);
}

function substitute(src, label, { json = false } = {}) {
  const unknown = new Set();
  let replaced = 0;
  const out = src.replace(tokenPattern, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(tokens, name)) {
      replaced++;
      const val = tokens[name];
      return json ? jsonStringEscape(val) : val;
    }
    unknown.add(name);
    return whole;
  });
  if (unknown.size) {
    console.error(`build-shop: ${label} has unknown token(s): ${[...unknown].join(', ')}. Add them to the tokens map or fix the template — refusing to ship a page containing raw {{tokens}}.`);
    process.exit(1);
  }
  return { out, replaced };
}

// Declare the site favicon in every page <head> so search engines and browser
// tabs show the shop logo, not a generic globe. Injected centrally here rather
// than editing every template/landing head. No-op if the page already sets one.
const faviconTags = `<link rel="icon" href="${faviconHref}"><link rel="apple-touch-icon" href="${faviconHref}">`;
function injectFavicon(html) {
  if (/rel=["']icon["']/i.test(html)) return html;
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n  ${faviconTags}`);
}

/* ---------- Meta (Facebook) Pixel ----------
   Opt-in per shop via config.marketing.metaPixelId (the numeric Pixel ID from
   Meta Events Manager). Empty/absent → nothing is emitted and functions/
   _middleware.js keeps the tighter CSP (connect.facebook.net is only allowed
   when a pixel is configured). The base snippet + PageView is injected into the
   <head> of every CUSTOMER-facing page (landing, order, thank-you, legal pages);
   the staff till UI is deliberately excluded. The thank-you page additionally
   fires a Purchase event with the real order value (see templates/thank-you.html).
   The inline snippet is externalised to a same-origin .js like every other inline
   script, so it runs under script-src 'self' without 'unsafe-inline'. */
const metaPixelId = String(config.marketing?.metaPixelId || '').trim();
const metaPixelOn = /^\d{6,20}$/.test(metaPixelId);
if (metaPixelId && !metaPixelOn) {
  console.warn(`⚠️  build-shop: marketing.metaPixelId "${metaPixelId}" is not a numeric Meta Pixel ID — pixel NOT emitted for "${slug}".`);
}
const metaPixelHead = metaPixelOn
  ? `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${metaPixelId}');fbq('track','PageView');
</script>
<noscript><img height="1" width="1" style="display:none" alt=""
src="https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1"/></noscript>`
  : '';
if (metaPixelOn) console.log(`build-shop: Meta Pixel ${metaPixelId} enabled for "${slug}".`);

function injectMetaPixel(html) {
  if (!metaPixelHead) return html;
  if (/connect\.facebook\.net/i.test(html)) return html; // already present — don't double-inject
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n  ${metaPixelHead}`);
}

// Move each inline <script> into a same-origin .js file (token substitution has
// already run, so the extracted JS is final) and replace it with <script src>.
// This lets the CSP use script-src 'self' instead of 'unsafe-inline'. Only plain
// <script> blocks are touched; <script src="…"> (Stripe) is left alone. Writes
// the .js files alongside their page in public/ and returns the rewritten HTML.
function externalizeInlineScripts(html, outRel) {
  const base = outRel.replace(/^public\//, '').replace(/\.html$/, '');
  let n = 0;
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (_m, body) => {
    const rel = `${base}.inline${n}.js`;
    const file = path.join(repoRoot, 'public', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    n++;
    return `<script src="/${rel}"></script>`;
  });
}

// The back office can be served at a non-obvious path (STAFF_PATH env, per shop,
// set in Cloudflare — NOT in git) so it isn't sitting at the guessable /staff/.
// We rewrite ONLY the web output: templates/staff/* and the bundled Sunmi app
// keep /staff/ internally, so the tills are untouched. Default 'staff' = no change.
const STAFF_PATH = (process.env.STAFF_PATH || 'staff').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'staff';
const moveStaff = STAFF_PATH !== 'staff';

for (const [tplRel, outRelRaw] of templatedFiles) {
  const isStaff = tplRel.startsWith('staff/');
  const outRel = (isStaff && moveStaff) ? outRelRaw.replace('public/staff/', `public/${STAFF_PATH}/`) : outRelRaw;
  const tplFile = path.join(repoRoot, 'templates', tplRel);
  const outFile = path.join(repoRoot, outRel);
  if (!fs.existsSync(tplFile)) {
    console.error(`build-shop: required template missing: templates/${tplRel}. Refusing to deploy an incomplete site.`);
    process.exit(1);
  }
  const src = fs.readFileSync(tplFile, 'utf8');
  let { out, replaced } = substitute(src, `templates/${tplRel}`, { json: outRel.endsWith('.json') });
  // Rewrite page-path refs (/staff/manifest.json, manifest start_url/scope/icons)
  // to the new path. The (?<!\/api) lookbehind leaves every /api/staff/ API call
  // alone, so the till's backend calls keep working.
  if (isStaff && moveStaff) out = out.replace(/(?<!\/api)\/staff\//g, `/${STAFF_PATH}/`);
  if (outRel.endsWith('.html')) {
    // Favicon on every page; Meta Pixel on customer-facing pages only (never the
    // internal staff till UI). Externalise inline scripts last, so the injected
    // pixel snippet is moved out to a same-origin .js like the rest.
    let page = injectFavicon(out);
    if (!isStaff) page = injectMetaPixel(page);
    out = externalizeInlineScripts(page, outRel);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  console.log(`build-shop: templates/${tplRel} -> ${outRel} (${replaced} token(s))`);
}

/* ---------- Landing page ----------
   Each shop can ship their own index.html in their shop folder (Rico's keeps
   a custom landing with bespoke brand copy). If absent, we fall back to the
   minimal default landing template. Both paths go through token substitution
   so phone / address / theme stay config-driven. */
{
  const shopLanding = path.join(shopDir, 'index.html');
  const defaultLanding = path.join(repoRoot, 'templates', 'landing-default.html');
  const srcLanding = fs.existsSync(shopLanding) ? shopLanding : defaultLanding;
  if (fs.existsSync(srcLanding)) {
    const src = fs.readFileSync(srcLanding, 'utf8');
    const label = srcLanding === shopLanding ? `data/shops/${slug}/index.html` : 'templates/landing-default.html';
    // Inject the shared persistent-basket bar before </body> on every landing,
    // then substitute tokens (so its {{themePrimary}} colour resolves per shop).
    const barFile = path.join(repoRoot, 'templates', 'basket-bar.html');
    const srcWithBar = (fs.existsSync(barFile) && src.includes('</body>'))
      ? src.replace('</body>', `${fs.readFileSync(barFile, 'utf8')}\n</body>`)
      : src;
    const { out, replaced } = substitute(srcWithBar, label);
    const outFile = path.join(repoRoot, 'public', 'index.html');
    fs.writeFileSync(outFile, externalizeInlineScripts(injectMetaPixel(injectFavicon(out)), 'public/index.html'));
    console.log(`build-shop: ${label} -> public/index.html (${replaced} token(s))`);
  } else {
    console.warn(`build-shop: no landing page found (shop or default); public/index.html left as-is`);
  }
}

// Sitemap with ABSOLUTE per-shop URLs. A relative <loc> ("/") is invalid per the
// sitemap protocol and Google may ignore it, so we generate it from the shop's
// own domain on each build (overwriting any committed copy).
{
  const origin = `https://${config.business.domain || ''}`;
  const urls = [['/', '1.0'], ['/order', '0.9'], ['/privacy', '0.3'], ['/terms', '0.3']];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map(([p, pr]) => `  <url><loc>${origin}${p}</loc><priority>${pr}</priority></url>`).join('\n')
  }\n</urlset>\n`;
  fs.writeFileSync(path.join(repoRoot, 'public', 'sitemap.xml'), xml);
  console.log('build-shop: generated public/sitemap.xml (absolute URLs)');
}

console.log(`build-shop: active shop is "${slug}".`);
