/* Print the Cloudflare Pages "Build watch paths" for every shop project.

   Run:  node tools/watch-paths.mjs
         node tools/watch-paths.mjs leaf-cafe     (just one project)

   Why this exists: each Pages project should rebuild ONLY when something it
   actually serves changes. Without exclusions a one-shop edit rebuilds every
   site — eight builds for a menu price. The lists are tedious and grow with
   every new shop, so they are generated from data/shops/ rather than written
   down somewhere that goes stale. Adding a shop? Re-run this and paste the new
   lists in; that is the step CLAUDE.md warns is easy to forget.

   Paste into: Pages project -> Settings -> Builds & deployments ->
               Build watch paths -> Exclude paths.   Include stays "*".

   NOTE ON NESTED FOLDERS: a shop folder can contain sub-directories
   (leaf-cafe/_source, tad-kebab/_reference-src). If Cloudflare's "*" turns out
   not to cross a "/", those would slip past the exclusion and still trigger
   rebuilds. Check one build after pasting these in — touch a file in a shop's
   sub-folder and confirm only that shop's project builds. */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shopsDir = path.join(root, 'data', 'shops');

const shops = readdirSync(shopsDir)
  .filter((d) => !d.startsWith('_'))
  .filter((d) => statSync(path.join(shopsDir, d)).isDirectory())
  .sort();

/* Excluded from EVERY project: scripts/build-shop.js never reads any of these,
   so a change to them cannot alter a single byte of any shop's built site.
   Verified by grep — the only mentions of tests/ and docs/ in build-shop.js are
   inside comments. app/ is the till, which deploys over the air via GitHub
   Actions, not through Pages. tools/ is design tooling. print/ stays in the list
   although the folder was archived out of the tree on 17 Sep 2026 (see
   docs/ARCHIVED_ASSETS.md) — the exclusion costs nothing and means the lists
   still work if anyone restores it to run the menu build.

   Worth knowing when you paste these in: an exclude stops a project BUILDING,
   it does not stop it CLONING. Every project clones the whole repo either way,
   which is why archiving 61 MB of unread binaries did more for deploy time than
   any exclusion could.

   NOT excludable, however tempting: scripts/* (build-shop.js IS the build) and
   public/* (gitignored except _headers and _redirects, which are served as-is).

   That scripts/* rule is WHY this file lives in tools/ rather than scripts/.
   scripts/ is watched by every project, so while the hand-run tooling sat in
   there, editing a generator — a file the build never reads — queued eight
   builds. scripts/ now holds build-shop.js and nothing else, so a build there
   always means a real build change. Put new hand-run tooling in tools/. */
const NEVER_BUILT = [
  'data/shops/_template/*',
  'tests/*',
  'test/*',
  'docs/*',
  'app/*',
  'print/*',
  'tools/*',
  '.github/*',
  '*.md',
];

const only = process.argv[2];
const targets = only ? shops.filter((s) => s === only) : shops;

if (only && !targets.length) {
  console.error(`No shop "${only}". Known: ${shops.join(', ')}`);
  process.exit(1);
}

console.log(`${shops.length} shop projects: ${shops.join(', ')}\n`);
console.log('Include paths:  *        (leave as-is on every project)\n');

for (const slug of targets) {
  const excl = [...shops.filter((s) => s !== slug).map((s) => `data/shops/${s}/*`), ...NEVER_BUILT];
  console.log(`─── project "${slug}" ─── Exclude paths (${excl.length}):`);
  for (const e of excl) console.log(`  ${e}`);
  console.log(`\n  one line: ${excl.join(', ')}\n`);
}

if (!only) {
  console.log('─── the Lumin admin project (PLATFORM_BUILD=1, no SHOP_SLUG) ───');
  console.log('  It serves templates/admin + data/platform, so exclude EVERY shop:');
  const excl = [...shops.map((s) => `data/shops/${s}/*`), ...NEVER_BUILT];
  console.log(`  one line: ${excl.join(', ')}\n`);
}
