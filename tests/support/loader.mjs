/* Test-only ESM loader. NOT shipped, NOT imported by any production code.
   Two jobs, both so the Cloudflare-bundled libs can run under bare `node --test`:

   1. Allow attribute-less JSON imports. The libs write `import x from './y.json'`
      (esbuild/wrangler rewrites these at bundle time); bare Node otherwise demands
      an `with { type: 'json' }` attribute the source doesn't carry.
   2. Redirect the generated `data/_active/{config,menu}.json` to the fixtures in
      tests/fixtures/, so pricing/hours tests run against a KNOWN synthetic shop
      instead of whichever shop was last built into data/_active. This keeps the
      tests deterministic and independent of `npm run build`.

   Enable with:  node --import ./tests/support/register.mjs --test tests/ */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = {
  [pathResolve(here, '../../data/_active/config.json')]: pathResolve(here, '../fixtures/config.json'),
  [pathResolve(here, '../../data/_active/menu.json')]: pathResolve(here, '../fixtures/menu.json'),
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.startsWith('file:')) {
    const p = fileURLToPath(r.url);
    if (fixtures[p]) return { ...r, url: pathToFileURL(fixtures[p]).href };
  }
  return r;
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    const p = fileURLToPath(url);
    return { format: 'json', source: readFileSync(p, 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}
