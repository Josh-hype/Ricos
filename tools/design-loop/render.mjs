#!/usr/bin/env node
/* Build a shop, screenshot its landing page, and dump a layout outline.
 *
 *   node tools/design-loop/render.mjs <slug> [--round N] [--page order]
 *
 * Writes into tools/design-loop/runs/<slug>/round-<N>/:
 *   desktop.png   1440x900  viewport, full page
 *   mobile.png     390x844  viewport, full page
 *   outline.json  every laid-out block: tag, classes, box, colours, font, text
 *   render.json   what was built, plus any console errors the page threw
 *
 * Why the outline: a critic agent looking at two pictures can tell you "the
 * hero is too tall", but not "it is 480px and the reference implies ~360". The
 * outline turns the render half of that comparison into numbers, so a fix can
 * be specific instead of another guess. It is also the only way to catch a
 * block that is present but invisible (0-height, clipped, behind something).
 *
 * Everything here is deliberately loud: a build failure, a page error or a
 * blank screenshot ABORTS. A loop that silently screenshots the previous
 * round's output would happily report convergence it never achieved.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const arg = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
};
if (!slug) {
  console.error('usage: node tools/design-loop/render.mjs <slug> [--round N] [--page order]');
  process.exit(2);
}
const round = arg('round', '0');
const pageName = arg('page', 'index');           // index | order | thank-you
const outDir = path.join(HERE, 'runs', slug, `round-${round}`);

/* ---------- 1. build ---------- */
const build = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'build-shop.js')], {
  cwd: REPO, env: { ...process.env, SHOP_SLUG: slug }, encoding: 'utf8',
});
const buildLog = (build.stdout || '') + (build.stderr || '');
if (build.status !== 0) {
  console.error(buildLog);
  console.error(`\nrender: build failed for "${slug}" — nothing was screenshotted.`);
  process.exit(1);
}
// The build defaults to ricos when SHOP_SLUG is unset/unknown. Screenshotting
// Rico's while believing it is the new shop is the exact failure this guards.
if (!buildLog.includes(`active shop is "${slug}"`)) {
  console.error(buildLog);
  console.error(`\nrender: build did not report active shop "${slug}" — refusing to screenshot.`);
  process.exit(1);
}
const warnings = buildLog.split('\n').filter((l) => /⚠️|warning|placeholder/i.test(l));

/* ---------- 2. the /api/config the page will see ---------- */
const stub = spawnSync(process.execPath,
  ['--import', path.join(REPO, 'tests', 'support', 'register.mjs'), path.join(HERE, 'api-stub.mjs')],
  { cwd: REPO, encoding: 'utf8' });
if (stub.status !== 0) {
  console.error(stub.stderr);
  console.error('render: could not compute the /api/config stub.');
  process.exit(1);
}
const apiConfig = stub.stdout;

/* ---------- 3. serve public/ ---------- */
const PUBLIC = path.join(REPO, 'public');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.avif': 'image/avif',
};
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- 4. shoot ---------- */
let pw;
for (const cand of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
  try { pw = (await import(cand)).default ?? (await import(cand)); break; } catch { /* next */ }
}
if (!pw) {
  console.error('render: playwright not found (tried "playwright" and /opt/node22/...).');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--no-proxy-server'] });
const pageErrors = [];
const externalFailures = [];
const blockedTrackers = new Set();
const shots = {};

/* ---------- external resources ----------
 * The browser is launched without a proxy (it cannot reach the internet), but
 * node's fetch can. So anything the page loads from outside is fetched here and
 * handed to the browser, cached on disk so a loop of six rounds pays for it once.
 *
 * This is not a nicety. Rico's landing pulls Anton, Archivo Black, Caveat and
 * DM Sans from Google Fonts; with those requests failing, the page renders in
 * Impact — while getComputedStyle still cheerfully reports "Anton". A typography
 * critic would then be comparing the reference against a font the live site
 * never shows, every round, for ever.
 *
 * Trackers are refused rather than fetched: a design render has no business
 * firing a Meta Pixel event, and the pixel's absence changes nothing visual.
 */
const CACHE = path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });
const TRACKERS = /(connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|doubleclick\.net)/;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchExternal(url) {
  // Google serves woff2 only to a modern UA; with node's default it hands back
  // ttf, which renders subtly differently. Hence the explicit Chrome UA.
  const key = path.join(CACHE, Buffer.from(url).toString('base64url').slice(0, 180));
  const meta = key + '.json';
  if (fs.existsSync(key) && fs.existsSync(meta)) {
    return { body: fs.readFileSync(key), ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  fs.writeFileSync(key, body);
  fs.writeFileSync(meta, JSON.stringify({ contentType }));
  return { body, contentType };
}

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

let outline = null;
for (const v of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile,
  });
  await ctx.route('**/api/config*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: apiConfig }));
  // Anything else under /api is a shape the landing page shouldn't depend on;
  // answer it emptily rather than letting it hang the networkidle wait.
  await ctx.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/*', async (r) => {
    const url = r.request().url();
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
    // Fulfilled empty rather than aborted: an abort logs a console error, and a
    // loop that cries wolf about the Meta Pixel every round teaches you to stop
    // reading the error list — which is where a real page fault would appear.
    if (TRACKERS.test(url)) {
      blockedTrackers.add(new URL(url).host);
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* blocked by design-loop */' });
    }
    try {
      const { body, contentType } = await fetchExternal(url);
      await r.fulfill({ status: 200, contentType, body });
    } catch (e) {
      externalFailures.push(`${url} :: ${e.message}`);
      await r.abort();
    }
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`[${v.name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`[${v.name}] console: ${m.text()}`); });

  await page.goto(`${base}/${pageName === 'index' ? '' : pageName + '.html'}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Let entrance animations settle, then freeze them — a screenshot taken
  // mid-fade reads as "the reference is more opaque here" for ever.
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: `*,*::before,*::after{animation-play-state:paused!important;transition:none!important}` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);   // trigger any scroll-reveal, then go back up
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  const file = path.join(outDir, `${v.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,   // NOT innerWidth: it inflates when the page overflows
    height: document.documentElement.scrollHeight,
  }));
  // A page wider than its own viewport is a horizontal-scroll bug, and it is
  // invisible in a full-page screenshot because the shot just gets wider.
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  // Did the type the page ASKS FOR actually arrive? getComputedStyle reports the
  // declared stack whether or not the file loaded, so it cannot answer this, and
  // a render in fallback type is worse than no render because it looks fine.
  //
  // Nor is "every FontFace is loaded" the question: faces load lazily, so every
  // weight the page declares but never uses sits at "unloaded" for ever and
  // gating on that fails a perfectly good render. What matters is the first
  // family of each stack actually applied to visible text.
  const fonts = await page.evaluate(() => {
    const used = new Map();
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const cs = getComputedStyle(el);
      const fam = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const key = `${cs.fontWeight} ${fam}`;
      if (!used.has(key)) used.set(key, { family: fam, weight: cs.fontWeight, available: document.fonts.check(`${cs.fontWeight} 1em "${fam}"`) });
    });
    return {
      usedForVisibleText: [...used.values()],
      errored: [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`),
    };
  });
  shots[v.name] = { file: path.relative(REPO, file), width, height, overflowPx: overflow, fonts };

  if (v.name === 'desktop') {
    outline = await page.evaluate(() => {
      const seen = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;             // decorative slivers
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
        const ownText = [...el.childNodes]
          .filter((n) => n.nodeType === 3 && n.textContent.trim())
          .map((n) => n.textContent.trim().replace(/\s+/g, ' ')).join(' ');
        const img = el.tagName === 'IMG' ? el.getAttribute('src')
          : (cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 160) : null);
        if (!ownText && !img && !/^(SECTION|HEADER|FOOTER|NAV|MAIN|ASIDE)$/.test(el.tagName)) return;
        seen.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
          box: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
          font: `${cs.fontFamily.split(',')[0].replace(/["']/g, '')} ${Math.round(parseFloat(cs.fontSize))}px/${cs.fontWeight}`,
          color: cs.color,
          bg: cs.backgroundColor,
          img,
          text: ownText.slice(0, 90),
        });
      });
      return seen;
    });
  }
  await ctx.close();
}
await browser.close();
server.close();

/* ---------- 5. report ---------- */
// A screenshot of a blank page is the loop's worst failure mode: every critic
// then reports the same "nothing is there", the fixer thrashes, and the run
// burns rounds. Catch it here instead.
for (const [name, s] of Object.entries(shots)) {
  if (s.height < 400) {
    console.error(`render: ${name} page is only ${s.height}px tall — that is a blank/broken render, not a design.`);
    process.exit(1);
  }
}

// A font that never arrived means the screenshot is in fallback type. Everything
// a typography critic then says is about a font the live site does not use, so
// this stops rather than feeding the loop a lie.
const fontProblems = Object.entries(shots).flatMap(([view, s]) => [
  ...(s.fonts?.errored || []).map((f) => `${view}: ${f} failed to load`),
  ...(s.fonts?.usedForVisibleText || []).filter((f) => !f.available)
    .map((f) => `${view}: visible text is set in "${f.family}" ${f.weight}, which is NOT available — rendering in fallback`),
]);
const fontFailures = externalFailures.filter((u) => /font|\.woff2?|\.ttf|\.otf|css2\?/i.test(u));

const report = {
  ok: true, outDir: path.relative(REPO, outDir), shots,
  pageErrors, externalFailures, blockedTrackers: [...blockedTrackers],
  buildWarnings: warnings, fontProblems,
};
fs.writeFileSync(path.join(outDir, 'outline.json'), JSON.stringify(outline, null, 1));
fs.writeFileSync(path.join(outDir, 'render.json'), JSON.stringify({ slug, round, page: pageName, ...report }, null, 1));
console.log(JSON.stringify(report, null, 1));

if (fontFailures.length || fontProblems.length) {
  console.error('\nrender: FONTS DID NOT LOAD — this screenshot is in fallback type and must not be');
  console.error('        critiqued for typography. Fix the fetch before looping.');
  for (const f of [...fontFailures, ...fontProblems]) console.error('        - ' + f);
  process.exit(1);
}
if (pageErrors.length) {
  console.error(`\nrender: the page threw ${pageErrors.length} error(s) — the screenshot may not be what ships.`);
}
