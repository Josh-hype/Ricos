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

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

// Shop selection: each Cloudflare Pages project sets its own SHOP_SLUG env
// var (for both Production and Preview). "ricos" is only a local-dev fallback
// so `npm run build` works without env setup.
const slug = (process.env.SHOP_SLUG || 'ricos').trim();
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

// How customers reach us (email when known, always the phone).
const contactParts = [];
if (email) contactParts.push(`by email at ${email}`);
if (phone) contactParts.push(`by phone on ${phone}`);
const contactLine = contactParts.join(' or ') || 'using the contact details on our website';

// Terms: the promotional-discount clause only appears for shops that run one.
const promo = config.promo?.autoOnlineDiscount;
const promoSection = (promo && promo.enabled)
  ? `<h2>Promotional discounts</h2>\n    <p>The ${promo.percent}% online discount is applied automatically to the subtotal of qualifying online orders. We may change or end this offer at any time.</p>`
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

for (const [tplRel, outRel] of templatedFiles) {
  const tplFile = path.join(repoRoot, 'templates', tplRel);
  const outFile = path.join(repoRoot, outRel);
  if (!fs.existsSync(tplFile)) {
    console.error(`build-shop: required template missing: templates/${tplRel}. Refusing to deploy an incomplete site.`);
    process.exit(1);
  }
  const src = fs.readFileSync(tplFile, 'utf8');
  let { out, replaced } = substitute(src, `templates/${tplRel}`, { json: outRel.endsWith('.json') });
  if (outRel.endsWith('.html')) out = externalizeInlineScripts(out, outRel);
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
    fs.writeFileSync(outFile, externalizeInlineScripts(out, 'public/index.html'));
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
