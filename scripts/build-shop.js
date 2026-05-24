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
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

// Shop selection order: SHOP_SLUG env var (set per Cloudflare Pages project)
// wins; then an optional committed .shopslug file (lets a project deploy the
// right shop even when its env var isn't wired up); then "ricos" for local
// dev. The env var always takes precedence, so shops that set it (Rico's)
// are unaffected by the file.
function shopSlugFromFile() {
  try {
    const f = path.join(repoRoot, '.shopslug');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  } catch { /* ignore */ }
  return '';
}
const slug = (process.env.SHOP_SLUG || shopSlugFromFile() || 'ricos').trim();
const shopDir = path.join(repoRoot, 'data', 'shops', slug);

if (slug.startsWith('_')) {
  console.error(`build-shop: shop slug "${slug}" starts with underscore. Underscore-prefixed folders (e.g. _template) are scaffolding, not deployable shops. Choose a real slug.`);
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
  ['menu-visual.json', 'public/menu-visual.json'],
  ['logo.png',         'public/logo.png'],
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

/* Per-shop static assets (food photos etc.): copy data/shops/<slug>/assets/*
   to public/assets/. Optional — shops without an assets/ folder skip this. */
{
  const shopAssets = path.join(shopDir, 'assets');
  if (fs.existsSync(shopAssets)) {
    const outAssets = path.join(repoRoot, 'public', 'assets');
    fs.mkdirSync(outAssets, { recursive: true });
    for (const f of fs.readdirSync(shopAssets)) {
      fs.copyFileSync(path.join(shopAssets, f), path.join(outAssets, f));
      console.log(`build-shop: ${slug}/assets/${f} -> public/assets/${f}`);
    }
  }
}

/* ---------- Template substitution ---------- */

const config = JSON.parse(fs.readFileSync(path.join(activeDir, 'config.json'), 'utf8'));

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

const tokens = {
  shopName:                config.business.tradingName || '',
  shopShortName:           config.business.shortName || config.business.tradingName || '',
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
];

const tokenPattern = /\{\{(\w+)\}\}/g;

function substitute(src, label) {
  const unknown = new Set();
  let replaced = 0;
  const out = src.replace(tokenPattern, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(tokens, name)) {
      replaced++;
      return tokens[name];
    }
    unknown.add(name);
    return whole;
  });
  if (unknown.size) {
    console.warn(`build-shop: ${label} has unknown token(s): ${[...unknown].join(', ')}`);
  }
  return { out, replaced };
}

for (const [tplRel, outRel] of templatedFiles) {
  const tplFile = path.join(repoRoot, 'templates', tplRel);
  const outFile = path.join(repoRoot, outRel);
  if (!fs.existsSync(tplFile)) {
    console.warn(`build-shop: template missing, skipping: templates/${tplRel}`);
    continue;
  }
  const src = fs.readFileSync(tplFile, 'utf8');
  const { out, replaced } = substitute(src, `templates/${tplRel}`);
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
    const { out, replaced } = substitute(src, label);
    const outFile = path.join(repoRoot, 'public', 'index.html');
    fs.writeFileSync(outFile, out);
    console.log(`build-shop: ${label} -> public/index.html (${replaced} token(s))`);
  } else {
    console.warn(`build-shop: no landing page found (shop or default); public/index.html left as-is`);
  }
}

console.log(`build-shop: active shop is "${slug}".`);
