# Phase 3 — Live updates (push UI changes to tills without a reinstall)

> Status: **scoped, ready to build.** Goal: change the staff UI — screens, where buttons
> go, copy, bug-fixes — and have **installed tills pick it up on next launch**, no APK
> reinstall, no shop visit. (Menu/prices/hours already update live — the till pulls those
> from the backend. This is about the *app's own screens*, which today are baked into the APK.)

## What does / doesn't update remotely
| Change | Updates remotely? |
|--------|-------------------|
| Menu, prices, opening hours, delivery, config | ✅ already — pulled live from the shop backend |
| Staff UI: screens, button layout, copy, web bug-fixes | ✅ **with this feature** (over-the-air web bundle) |
| Native shell: printer/drawer, Stripe Terminal, the wrapper itself | ❌ needs a new APK (rare) |

## Why not just load the live website (`server.url`)
The obvious idea — point the app at `BASE/staff` so it's always the latest — **doesn't fit**:
Capacitor only injects the native bridge (plugins, our `native.js` token/hardware shims) for the
app's *own* origin, not an arbitrary remote URL, and `server.url` is one static URL baked into the
APK (it can't be the per-device provisioned shop). So we keep the **bundled-app** model and swap the
**web layer** over-the-air instead.

## Recommended approach: `@capgo/capacitor-updater` (self-hosted)
Open-source, **no monthly fee**, self-hostable. Auto-update mode: on launch the app checks a URL,
downloads a newer web bundle, and applies it next launch.

- **Key simplifier:** the web bundle is **identical for every shop** (shop data comes from each
  device's own backend at runtime via the shims). So **one bundle at one fixed URL serves all
  tills** — the update URL is static, no per-device wiring.
- **Safety — auto-rollback:** the bundle calls `CapacitorUpdater.notifyAppReady()` once the staff UI
  boots; if a bad bundle fails to call it, Capgo **reverts to the APK's built-in bundle**. Worst case
  is "update didn't apply," never a bricked till. (Also supports a manual one-click rollback.)

### The three pieces
1. **App** (small, mostly config): add `@capgo/capacitor-updater`; set `autoUpdate` + the update URL
   in `capacitor.config.json`; call `notifyAppReady()` after the staff page loads (one line in the
   shim). Rebuild the APK **once** to bake in the updater.
2. **Release pipeline** (a script): `npm run build` + `sync-web` → `@capgo/cli` zips the `www/` bundle,
   bumps the version, and uploads it to the host. One command to ship a UI update to every till.
3. **Host** (one-time, owner): a fixed public URL serving the latest bundle + manifest. Options, no
   monthly fee: **(a)** a small dedicated Cloudflare Pages project (e.g. `lumipos-updates`), or
   **(b)** a public Cloudflare **R2** bucket. (Capgo's own cloud has a free tier too, if preferred.)

## Build order (each step verifiable)
1. Wire the updater + `notifyAppReady` + config (auto-rollback ON). Rebuild APK, install on the T2.
2. Stand up the host (a/b above) and the release script.
3. **Prove it on the T2 first:** ship a tiny visible change (move a button), confirm the T2 picks it
   up on relaunch and that a deliberately-broken bundle auto-rolls-back. *Then* it's safe for all tills.

## Owner action / open decision
- **Pick the host:** dedicated Cloudflare Pages project (recommended) vs R2 vs Capgo cloud. Tell me
  which and I'll wire it.
- This is the one piece that must be **built + tested on the device** (it changes how the app loads
  its UI). Auto-rollback makes that safe, but I won't ship it to live tills until the T2 test passes.
