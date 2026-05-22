#!/usr/bin/env node
/* Multi-tenant build step.

   Cloudflare Pages runs this before deploying each Pages project. The
   project's SHOP_SLUG environment variable picks which subfolder of
   data/shops/<slug>/ becomes the "active" set of config + assets for
   this deploy:

     data/shops/<slug>/config.json   -> data/_active/config.json
     data/shops/<slug>/menu.json     -> data/_active/menu.json
     data/shops/<slug>/logo.png      -> public/logo.png

   Server-side imports (functions/_lib/config.js etc.) always read
   from data/_active/, which is rebuilt per deploy.
   public/logo.png is overwritten in place so the email + page logo
   URL stays stable across shops.

   Run with SHOP_SLUG=<slug> (defaults to "ricos" so local dev works
   without env setup). */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const slug = (process.env.SHOP_SLUG || 'ricos').trim();
const shopDir = path.join(repoRoot, 'data', 'shops', slug);

if (!fs.existsSync(shopDir)) {
  console.error(`build-shop: no shop folder at data/shops/${slug}. Set SHOP_SLUG correctly or create the folder.`);
  process.exit(1);
}

const activeDir = path.join(repoRoot, 'data', '_active');
fs.mkdirSync(activeDir, { recursive: true });

const copies = [
  // [from inside shop folder, to inside repo]
  ['config.json', 'data/_active/config.json'],
  ['menu.json',   'data/_active/menu.json'],
  ['logo.png',    'public/logo.png'],
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

console.log(`build-shop: active shop is "${slug}".`);
