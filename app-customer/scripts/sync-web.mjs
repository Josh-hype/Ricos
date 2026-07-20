/* sync-web.mjs — assemble the customer app's bundled web layer (app-customer/www)
   from the BUILT order + thank-you pages, injecting the app shims. Adapted from
   the till's app/scripts/sync-web.mjs. Run from app-customer/ after BOTH:

     (repo root)     SHOP_SLUG=<slug> npm run build
     (app-customer)  SHOP_SLUG=<slug> npm run gen

   It never modifies templates/ or public/ — it reads the built pages and
   writes into app-customer/www (gitignored).

   App-bundle-only path rewrites (the deployed website is untouched):
     /thank-you?ref=  ->  /thank-you.html?ref=
        The page navigates (and points Stripe's return_url) at /thank-you.
        On the web that's a Cloudflare clean URL; inside the app the WebView
        serves bundled FILES, and an extensionless path would fall back to
        index.html (the order page) — so the bundle uses the explicit filename.
     href="/" and href="/order"  ->  href="/index.html"   (thank-you page only)
        Its "order again" buttons must reopen the bundled order page. */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));   // app-customer/scripts
const appDir = resolve(here, '..');                      // app-customer
const repoRoot = resolve(appDir, '..');                  // repo root
const publicDir = resolve(repoRoot, 'public');
const wwwDir = resolve(appDir, 'www');

// ── Preconditions: gen ran, and the root build is for the SAME shop ──────────
const metaFile = resolve(appDir, 'gen', 'build-meta.json');
if (!existsSync(metaFile)) {
  console.error('\n✗ gen/build-meta.json not found — run `npm run gen` first (SHOP_SLUG=<slug>).');
  process.exit(1);
}
const meta = JSON.parse(readFileSync(metaFile, 'utf8'));

const orderHtmlFile = resolve(publicDir, 'order.html');
if (!existsSync(orderHtmlFile)) {
  console.error('\n✗ public/order.html not found. Build the site first, from the repo root:');
  console.error(`\n    SHOP_SLUG=${meta.slug} npm run build\n`);
  process.exit(1);
}

// The root build stamps the shop's domain into public/sitemap.xml — use that to
// refuse a mixed bundle (order page built for shop A, app identity for shop B).
const sitemapFile = resolve(publicDir, 'sitemap.xml');
if (existsSync(sitemapFile) && !readFileSync(sitemapFile, 'utf8').includes(`https://${meta.domain}/`)) {
  console.error(`\n✗ public/ was built for a different shop (sitemap has no https://${meta.domain}/).`);
  console.error(`  Re-run the root build for THIS shop first: SHOP_SLUG=${meta.slug} npm run build\n`);
  process.exit(1);
}

mkdirSync(wwwDir, { recursive: true });

// ── Shims into www/ (load order matters: baked config → shim → push) ─────────
copyFileSync(resolve(appDir, 'gen', 'app-base.js'), resolve(wwwDir, 'app-base.js'));
copyFileSync(resolve(appDir, 'web', 'native.js'), resolve(wwwDir, 'native.js'));
copyFileSync(resolve(appDir, 'web', 'push.js'), resolve(wwwDir, 'push.js'));

const inject =
  '\n  <script src="./app-base.js"></script>' +
  '\n  <script src="./native.js"></script>' +
  '\n  <script src="./push.js"></script>\n';

function injectShims(html) {
  if (html.includes('./native.js')) return html; // idempotent
  if (html.includes('</head>')) return html.replace('</head>', inject + '</head>');
  return inject + html;
}

const thankYouRewrite = (s) => s.split('/thank-you?ref=').join('/thank-you.html?ref=');

// ── Order page → www/index.html (the app's start page) ───────────────────────
writeFileSync(resolve(wwwDir, 'index.html'), thankYouRewrite(injectShims(readFileSync(orderHtmlFile, 'utf8'))));

// ── Thank-you page → www/thank-you.html ──────────────────────────────────────
const thankYouFile = resolve(publicDir, 'thank-you.html');
if (!existsSync(thankYouFile)) {
  console.error('✗ public/thank-you.html not found — the root build is incomplete.');
  process.exit(1);
}
let ty = injectShims(readFileSync(thankYouFile, 'utf8'));
ty = ty.replace(/href="\/(order)?"/g, 'href="/index.html"'); // back-to-order buttons reopen the bundle
writeFileSync(resolve(wwwDir, 'thank-you.html'), ty);

// ── The pages' CSP-externalised inline scripts (absolute /<page>.inlineN.js) ──
// Parser-loaded <script src>, which the fetch shim can't rewrite — they must be
// bundled at the www root or the pages load with NO JS (same lesson as the till).
let bundled = 0;
for (const f of readdirSync(publicDir)) {
  if (/^(order|thank-you)\.inline\d+\.js$/.test(f)) {
    writeFileSync(resolve(wwwDir, f), thankYouRewrite(readFileSync(resolve(publicDir, f), 'utf8')));
    bundled++;
  }
}
if (!bundled) {
  console.error('✗ no order.inline*.js found in public/ — the root build is incomplete or its layout changed.');
  process.exit(1);
}

// The order header references the logo RELATIVELY (<img src="logo.png">), which
// neither the fetch shim nor the parser-asset rewrite (both keyed on leading /)
// touches — bundle it. Menu photos (/assets/menu/*) stay un-bundled on purpose:
// they're rewritten to the live site, so menu/photo edits never need an app
// update.
copyFileSync(resolve(publicDir, 'logo.png'), resolve(wwwDir, 'logo.png'));

console.log(`✓ synced customer UI for "${meta.slug}" → app-customer/www (shims injected, ${bundled} inline script(s) bundled)`);
console.log('  next: `cap add android`/`cap add ios` (first time) or `cap sync`.');
