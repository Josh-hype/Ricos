/* sync-web.mjs — assemble the app's bundled web layer (app/www) from the built
   staff EPOS, injecting the native shim + provisioning so the app loads the same
   UI as the website. Run from app/ via `npm run sync-web` (or sync / prepare:android).

   It does NOT modify the repo's templates or public/ — it only reads the built
   staff page and writes into app/www (which is gitignored). */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));     // app/scripts
const appDir = resolve(here, '..');                        // app
const repoRoot = resolve(appDir, '..');                    // repo root
const builtStaff = resolve(repoRoot, 'public', 'staff', 'index.html');
const wwwDir = resolve(appDir, 'www');

if (!existsSync(builtStaff)) {
  console.error('\n✗ public/staff/index.html not found.');
  console.error('  Build the staff UI first, from the repo root:\n');
  console.error('    SHOP_SLUG=ricos npm run build\n');
  process.exit(1);
}

mkdirSync(resolve(wwwDir, 'plugins'), { recursive: true });

// Copy the shim/provisioning/plugin web files into www/.
const webFiles = [
  ['web/plugins/epos-hardware.js', 'plugins/epos-hardware.js'],
  ['web/native.js', 'native.js'],
  ['web/provision.js', 'provision.js'],
];
for (const [from, to] of webFiles) {
  copyFileSync(resolve(appDir, from), resolve(wwwDir, to));
}

// Inject the shim scripts into the <head> so they run before the inline staff
// script (which is at the end of <body>). Order matters: plugin proxy → shim →
// provisioning.
const inject =
  '\n  <script src="./plugins/epos-hardware.js"></script>' +
  '\n  <script src="./native.js"></script>' +
  '\n  <script src="./provision.js"></script>\n';

let html = readFileSync(builtStaff, 'utf8');
if (html.includes('./native.js')) {
  // already injected (shouldn't happen on a fresh build, but be idempotent)
} else if (html.includes('</head>')) {
  html = html.replace('</head>', inject + '</head>');
} else {
  html = inject + html;
}
writeFileSync(resolve(wwwDir, 'index.html'), html);

console.log('✓ synced staff UI → app/www/index.html (shim injected)');
console.log('  next: `cap add android` (first time) or `cap sync android`, then `cap open android`.');
