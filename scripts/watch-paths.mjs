/* Print the Cloudflare Pages "Build watch paths" for every shop project.

   Run:  node scripts/watch-paths.mjs
         node scripts/watch-paths.mjs leaf-cafe     (just one project)

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
   Actions, not through Pages. */
const NEVER_BUILT = [
  'data/shops/_template/*',
  'tests/*',
  'test/*',
  'docs/*',
  'app/*',
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
