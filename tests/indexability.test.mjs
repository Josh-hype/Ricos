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
