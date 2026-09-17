# Archived assets — print artwork and design sources

**Nothing here is deleted.** 61.2 MB across 74 files was taken out of `main`'s
working tree on **17 Sep 2026**. Every byte is still in the repository, in the
history, and restoring any of it is one command.

## Why

All **nine** Cloudflare Pages projects clone this repo on every build, and the
repo had grown to ~146 MB. Build watch paths decide whether a project **builds**;
they do **not** stop it **cloning**. So `print/*` and `tools/*` being excluded
never saved a byte of transfer — every project still pulled the lot, then
ignored it. Nothing in `scripts/build-shop.js` has ever read any of these files.

## What moved

| Path | Size | What it was |
|---|---|---|
| `print/` | 47.0 MB | Big Bites' A3 trifold menu — the PDF, its render scripts, reference scans and food photography |
| `data/shops/leaf-cafe/_source/` | 5.6 MB | Leaf's logo master and hero originals |
| `data/shops/tad-kebab/_reference-src/` | 5.6 MB | Tad Kebab's landing-page design visuals |
| `data/shops/dominic-pizza/_source/` | 1.4 MB | Dominic's logo artwork |
| `data/shops/acomb-pizza-kebab/_reference-src/` | 1.1 MB | Acomb's landing-page design source |
| `data/shops/acomb-pizza-kebab/reference/` | 0.6 MB | Acomb's design reference images |

## Restoring

Everything lives at commit `09f3db4febb6aa1632878983a114438b66b52530`, which is a permanent ancestor of `main`.

```bash
# one folder back into the working tree
git checkout 09f3db4febb6aa1632878983a114438b66b52530 -- print/

# a single file, without staging it
git show 09f3db4febb6aa1632878983a114438b66b52530:data/shops/leaf-cafe/_source/logo-master.png > /tmp/logo-master.png

# just look at what was in there
git ls-tree -r --name-only 09f3db4febb6aa1632878983a114438b66b52530 -- print/
```

Restore, run the tool, then `git rm -r --cached` the folder again before
committing, so it does not go back into the clone.

## Tools that read these paths

These are all **hand-run**, never part of a build, so they only need the files
present while you are actually running them:

- `tools/_gen-leaf-brand.py` — reads `data/shops/leaf-cafe/_source/`
- `tools/design-loop/` — reads `data/shops/<slug>/reference/`
- `print/big-bites/build-menu.mjs` — lives in the archived folder itself

## If you want them out of the clone entirely

Removing them from the tip shrinks what a **shallow** clone fetches, which is
what CI normally does. A **full** clone still pulls the blobs out of history, so
the only way to guarantee a smaller clone is rewriting history
(`git filter-repo`) and force-pushing — which rewrites every commit SHA and
would need all nine Pages projects re-pointed. Not done, and not worth it
without a measured reason.

The durable fix is to keep large binaries out of the repo in the first place:
put print artwork and design originals in Drive or an R2 bucket, and commit only
the derived files the build actually ships.
