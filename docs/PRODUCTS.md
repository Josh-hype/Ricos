# Products & hardware — what Lumin Labs actually sells

**Read this before talking about "the till" or "the app".** There are **two
products** and **two pieces of hardware**, and they are not the same thing. This
file is the source of truth for which is which, so nobody has to explain it
again.

---

## The two product lines

| | **LumiPOS** | **LumiWEB** |
|---|---|---|
| What it is | The **full EPOS system** — the shop runs its whole counter on it | **Website only** — online ordering + the web back office |
| Hardware on site | **Sunmi T2** (dual-screen all-in-one till) | **ZCS Z93** (small Android unit, built-in 80mm printer) |
| Takes counter sales? | ✅ yes — walk-in / collection / delivery, cash + card, drawer, Z report | ❌ no — the Z93 receives and prints **online** orders |
| Cash drawer | ✅ (RJ11 off the printer) | ❌ the Z93 has no drawer port |
| Card terminal | separate reader (Stripe Terminal — still Phase 3) | n/a — customers pay online |
| Typical price | **£35/wk** itemised (software £10 + till hardware £15 + card terminal £10) | **£19/wk** all-in |

Both products are served by **this one repo**. Nothing forks. A LumiWEB shop is
an ordinary `data/shops/<slug>/` folder with an ordinary Cloudflare Pages
project — the difference is **commercial and physical**, not architectural.
There is deliberately **no `product: "lumiweb"` flag in `config.json`**: the code
has nothing to branch on, because both products build and deploy identically.

---

## The two devices — don't mix them up

### Sunmi T2 (LumiPOS)
The **big one**: dual-screen desktop till, customer-facing second screen,
built-in 80mm thermal printer, cash-drawer port. This is the full POS. Rico's
runs a **T2s** (the variant the app was hardened against — see the WebView
gotchas in `docs/SESSION_HANDOFF.md`).

- Printer driven by the **Sunmi inner-printer (woyou) service**,
  `com.sunmi:printerlibrary:1.0.24` from Maven Central.
- Print head is 80mm ≈ **576 dots**.
- No NFC ⇒ **Tap-to-Pay on the T2 is a non-starter** (`docs/PHASE3_TERMINAL.md`).

### ZCS Z93 (LumiWEB)
The **small one**: compact Android terminal with a **built-in 80mm printer** and
nothing else. It sits on the counter of a website-only shop so staff see and
print online orders as they land. **It is not a Sunmi and it is not a T2.**

- Printer driven by the **ZCS SmartPos SDK**, a bundled AAR:
  `app/native/android/libs/SmartPos_2.0.6_R260615.aar` (verified against
  SmartPos 2.0.6). Same SDK covers the Z90/Z91/Z92 siblings.
- `kickDrawer()` returns `drawer-not-connected` here — correct, there is no drawer.
- ⚠️ The Z93 in the field runs a **debug build**, so updating it is tied to the
  one MacBook that produced the APK. Signing it is an open item (`docs/TODO.md`).

---

## One APK, both devices

There is a **single Android app** — `uk.co.ricos.epos`, launcher name
**LumiPOS** — and it runs on both. It is a Capacitor wrapper around the shared
staff UI in `templates/staff/`.

**The printer backend is chosen at runtime, per call**, in
`app/native/android/EposHardwarePlugin.java`:

1. Is the Sunmi service bound? → print via Sunmi.
2. Otherwise, can the ZCS SDK come up? → print via ZCS.
3. Neither → `{ ok:false, reason:"printer-not-connected" }`, surfaced to staff.

Sunmi is checked **first** on purpose: the ZCS probe costs a `sysPowerOn` plus a
1-second sleep on hardware that has no ZCS board, and a T2 would otherwise pay
that on every print. The ZCS probe is capped at **2 attempts** so a non-ZCS till
stops paying for it once the answer is settled. Detection is per call rather
than once at `load()` because the Sunmi service binds **asynchronously** — a
decision taken at load would wrongly pin "no printer" on a T2 that simply hadn't
bound yet.

Receipt **layout** lives entirely in the web layer (`buildReceiptText` /
the `printDoc` op list in the staff UI), so a receipt change ships **over the
air** and never needs an APK rebuild.

### Provisioning either device
Both use the same flow: a **6-digit Restaurant ID** plus the shop's
`TILL_SETUP_PASSWORD`, or the "use a site address instead" fallback. The ID →
host directory is in `app/web/provision.js`:

| Restaurant ID | Shop | Host |
|---|---|---|
| `190059` | Rico's Peri Peri | `https://ricosyork.co.uk` |
| `833541` | Big Bites (slug `food-station`) | `https://bigbiteseasingwold.co.uk` |
| `318181` | Mega Chippy | `https://acombmegachippy.uk` |
| `604827` | Acomb Pizza & Kebab House | `https://acombpizzakebabhouse.co.uk` |

**Adding a shop with a device means adding it here** — and the host must be the
shop's reachable custom domain, never a `*.pages.dev` (those are firewalled on
this Cloudflare setup and return 403).

---

## Who is on what today

| Shop | Slug | Product | Weekly | Device |
|---|---|---|---|---|
| Rico's Peri Peri | `ricos` | LumiPOS | £35 (itemised) | Sunmi T2s |
| Big Bites, Easingwold | `food-station` | LumiPOS (all-in rate) | £19 | on site — **model not recorded, confirm and fill in** |
| Mega Chippy, Acomb | `mega-chippy` | **LumiWEB** | £19 | ZCS Z93 |
| One Sip | `one-sip` | LumiPOS, till-only (no website, no Stripe) | £0 — family venue, provided free | not provisioned in `provision.js` |
| The Grub Hub | `grub-hub` | LumiPOS | £35 | pre-launch |
| Acomb Pizza & Kebab House | `acomb-pizza-kebab` *(pre-launch — awaiting Stripe Connect)* | **LumiWEB** | £19 | Z93 to supply |

Commercial state (Stripe Connect, subscription status, processor) is in
`data/platform/registry.json`, which the owner console reads. Note it currently
shows **Mega Chippy's subscription as `pending`** — agreed £19/wk with the first
week free, due to complete w/c 20 Jul 2026.

---

## Naming

- **LumiPOS** — the product *and* the Android app's launcher name (which is why
  the app is called LumiPOS even on a LumiWEB shop's Z93). Don't rename it: the
  Capgo OTA channel, the app id `uk.co.ricos.epos` and every provisioned device
  are tied to it.
- **LumiWEB** — the website-only product. It has no separate app.
- **Lumin Labs** — the company (`data/platform/registry.json` → `platform`).

## Where to go next

| Question | File |
|---|---|
| Build/sign the APK | `app/README.md` |
| Native printer plugin details | `app/native/android/README.md` |
| OTA pipeline (Capgo + the GitHub Action) | `docs/SESSION_HANDOFF.md`, `docs/PHASE3_LIVE_UPDATE.md` |
| Charging a shop | `docs/BILLING.md`, `scripts/setup-billing.mjs` |
| Adding a shop | `docs/ADDING_A_SHOP.md`, `docs/SHOP_CHECKLIST.md` |
| Card terminal (Phase 3) | `docs/PHASE3_TERMINAL.md` |
