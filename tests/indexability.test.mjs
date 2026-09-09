/* The two files that decide whether Google may index a shop site at all:
   public/_headers and robots.txt.

   `PLATFORM_BUILD=1 npm run build` (the Lumin owner console) deliberately
   overwrites both with noindex / Disallow-all, because the admin console must
   stay out of search. Both builds write into the same public/ directory, so
   running the platform build locally silently rewrites the shop files, and a
   `git add -A` then commits a site-wide noindex to every shop. That happened
   once (commit ddc4745) and would have deindexed all three live shops. These
   tests are the tripwire.

   Both are now GENERATED into public/ from templates/, and both public copies
   are gitignored, so the accident is no longer possible to commit at all. These
   tests therefore assert on the templates — the committed sources — rather than
   on the build output, which does not exist until a build has run. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Comments are stripped before asserting: these files explain the noindex
// footgun in their own header, and matching on prose would fail the check that
// the prose exists to describe.
const read = (p) =>
  readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/^\s*#.*$/gm, '');

test('templates/_headers lets search engines index the shop sites', () => {
  const h = read('templates/_headers');
  assert.match(h, /X-Robots-Tag:\s*index,\s*follow/,
    'templates/_headers must allow indexing — did a PLATFORM_BUILD=1 run overwrite it?');
  assert.doesNotMatch(h.split('/api/')[0], /noindex/,
    'the site-wide (/*) rule must not contain noindex');
});

test('templates/robots.txt allows crawling, and keeps private paths out', () => {
  const r = read('templates/robots.txt');
  assert.match(r, /^\s*Allow:\s*\/\s*$/m,
    'robots.txt must Allow: / — did a PLATFORM_BUILD=1 run overwrite it?');
  assert.doesNotMatch(r, /^\s*Disallow:\s*\/\s*$/m,
    'robots.txt must not Disallow the whole site');
  // The paths that should stay unindexed.
  for (const p of ['/api/', '/staff/', '/thank-you']) {
    assert.ok(r.includes('Disallow: ' + p), `robots.txt should disallow ${p}`);
  }
});

test('the template carries no Sitemap line — the build adds an absolute one', () => {
  // A relative "Sitemap: /sitemap.xml" is invalid per the protocol and silently
  // ignored by Google, which is the bug this generation step exists to fix. The
  // template must not reintroduce one, because the build appends the real line.
  const r = read('templates/robots.txt');
  assert.doesNotMatch(r, /^\s*Sitemap:/im,
    'templates/robots.txt must not hard-code a Sitemap line — it would be relative, '
    + 'and per-shop domains mean only the build can write an absolute one');
});

/* The pre-launch flag, from the other direction.

   `prelaunch: true` in a shop's config makes the build write a Disallow-all
   robots.txt and a site-wide noindex header. That is right for a shop whose
   Cloudflare project exists before its real menu does, and catastrophic for a
   trading one: a live shop that silently acquired the flag would drop out of
   Google, and recovering an index is far slower than losing it.

   So the flag is asserted absent on every shop that takes real orders. This is
   the test that would have to fail before a live site could be deindexed by a
   stray config edit. */
import { readdirSync } from 'node:fs';

const LIVE_SLUGS = ['ricos', 'food-station', 'mega-chippy', 'acomb-pizza-kebab'];

const shopConfig = (slug) =>
  JSON.parse(readFileSync(new URL(`../data/shops/${slug}/config.json`, import.meta.url), 'utf8'));

test('no live shop is marked prelaunch', () => {
  for (const slug of LIVE_SLUGS) {
    assert.notEqual(shopConfig(slug).prelaunch, true,
      `${slug} is LIVE and takes real orders — prelaunch:true would deindex it. `
      + 'If this shop really has closed, remove it from LIVE_SLUGS deliberately.');
  }
});

test('every prelaunch shop is one we know is unlaunched', () => {
  // The inverse guard: a shop carrying the flag should be a shop we expect to
  // carry it. A slug appearing here that nobody recognises means either a live
  // shop was flagged by mistake, or a launch happened and the flag outlived it.
  const expected = new Set(['tad-kebab', 'grub-hub']);
  const flagged = readdirSync(new URL('../data/shops/', import.meta.url))
    .filter((s) => !s.startsWith('_'))
    .filter((s) => { try { return shopConfig(s).prelaunch === true; } catch { return false; } });
  for (const slug of flagged) {
    assert.ok(expected.has(slug),
      `${slug} carries prelaunch:true but is not in the expected set. Either it has `
      + 'launched (remove the flag) or it was flagged by mistake (it is invisible to Google).');
  }
});
