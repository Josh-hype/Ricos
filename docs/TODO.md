# TODO / backlog

Running list of agreed follow-ups. Newest at the top.

## Menu editor — replace the whole-menu override with an overlay  ⏳ AGREED 18 Sep 2026

**Do this while the shops are CLOSED.** It changes how every live menu is
resolved, on nine trading shops, and pricing is the one thing that must not be
wrong for even one order.

### The problem, in one line

The editor does not edit the menu — it takes a COMPLETE COPY of it into KV
(`setting:menu`), and from the first Save that copy is authoritative. The repo
then stops mattering for that shop.

Everything below followed from that single decision, and all of it was hit on
17–18 Sep:

| Symptom | Cause |
|---|---|
| Mega Chippy sold a £25.90 Big Mega Box for £23.01 | `noPromo` dropped, so the 15% welcome promo applied to a meal deal |
| Dominic's crust/size defaults never appeared on the till | `default` / `posDefault` dropped the same way |
| "Chip spice" stayed on the till after being deleted from the repo | a REMOVAL cannot be healed — the stored copy still had the group |
| Nothing could be fixed except "Discard all edits" | the override is all-or-nothing |

The mechanism is always the same: each transform (`unifyStatic`,
`validateUnified`, `deriveServerMenu`, `deriveVisualMenu`) rebuilds every item
and every choice from scratch and copies a hand-written list of fields. Anything
not on the list is silently dropped, and a NEW field must be remembered in all
four places or it dies too.

Additions from the repo are now healed at read time (`healFlags` /
`healChoiceFlags`). Removals deliberately are not: auto-deleting anything absent
from the repo would wipe whatever a shop legitimately added in the editor.

### What to keep

One stored document deriving BOTH the customer menu and the pricing menu. That
is why the price shown can never drift from the price charged, and it should
survive the rewrite untouched.

### The shape to build

Split **structure** (repo, via the per-shop generator) from **operations**
(overlay, via the editor):

- repo owns: categories, items, option groups, choices and their ids, `noPromo`,
  `default`, `posDefault` — anything structural
- overlay owns, per id, ONLY the fields actually changed:
  `{ "pizza-margherita": { "priceP": 880 }, "burgers-mega-burger": { "hidden": true } }`
  — price, hidden/sold-out, description, photo

Applied on top of the repo menu on read. What that buys:

- field dropping becomes IMPOSSIBLE, because nothing is copied
- removals and additions in the repo flow straight through — no Chip spice again
- the stored data is a few readable lines instead of an 800 KB parallel menu
- per-item revert ("back to the built-in price") instead of all-or-nothing
- you can see at a glance what a shop has overridden

**The trade, accepted:** a shop can no longer invent a new ITEM itself. For this
business that is right — menus are built from the owner's workbook by the
generator, and a shop needing a new item is a five-minute generator change that
ends up reviewed and permanent instead of stranded in one shop's KV.

### Order of work

- [ ] **1. Pass-through instead of allow-list** (~1 hour, low risk, can ship any
      time). Copy the whole item/choice and validate the fields we know, rather
      than constructing a new object from a list. Kills the field-dropping class
      of bug permanently on its own, and is worth doing BEFORE the rewrite so the
      rewrite is not also carrying that risk.
- [ ] **2. Audit menu saves** (~20 min). There is currently NO logging on
      `PUT /api/staff/menu` — a pizza can go from £8.20 to £5.20 with no record
      of who or when. `logAudit` already exists for refunds, voids and sign-ins;
      price changes are money and belong there.
- [ ] **3. The overlay rewrite** (~a day, shops closed). Tests written BEFORE
      behaviour: the existing `tests/nopromo-survives-editing.test.mjs` and
      `tests/negative-delta.test.mjs` are the shape to follow, and both must keep
      passing.
- [ ] **4. Show overrides in the editor** — mark an overridden field and show the
      built-in value beside it, with a per-row revert.
- [ ] **5. Migrate the shops that already have an override.** Known: Mega Chippy
      and Dominic Pizza (Dominic's was cleared on 18 Sep, so it may be clean
      again — check `source` in `GET /api/staff/menu`, which reports `live` vs
      `built-in`). Any shop showing `live` needs its real edits read out of the
      stored doc and re-expressed as an overlay, or re-entered.

### Until it is done

- Menu changes for a shop we are actively developing go through the generator,
  not the editor.
- **Sold out is safe** — availability is a separate mechanism and does not create
  an override, so staff can keep turning items off.

## Mega Chippy — migrate fully to `acombmegachippy.uk`  ✅ DONE 2026-07-29
Completed. `acombmegachippy.uk` is the shop's only domain; `megachippy.co.uk` has
been detached from the Pages project and is free to be resold.

- [x] **`acombmegachippy.uk` serves properly** — `/api/config` returns, a test
      order completed, and the shop took real orders on it.
- [x] **Canonical/SEO** — `business.domain` is `acombmegachippy.uk`, so the
      canonical tag, JSON-LD, sitemap and OG tags all match the Google listing.
- [x] **TILL moved** — `provision.js` Restaurant ID `318181` →
      `https://acombmegachippy.uk`; the shop's device was re-provisioned via the
      "use a site address" route.
- [x] **Email** — `acombmegachippy.uk` verified in Resend, Email Routing set up,
      `RESEND_FROM_EMAIL` = `orders@acombmegachippy.uk`, `business.email` updated.
- [x] **`megachippy.co.uk` removed** from the Pages project; its redirect rules
      and every config reference have been stripped from the repo.
- [x] **Google Business Profile** now points at `acombmegachippy.uk`.
- [ ] **Re-register the wallet domain** — log into
      `https://acombmegachippy.uk/staff`, then hit `/api/staff/wallet-domain`
      (expect `applePay` / `googlePay: active`). Apple and Google Pay register
      against the EXACT host, so the old registration doesn't carry over and the
      wallet buttons stay hidden at checkout until this is run. It must go through
      that endpoint: Connect direct-charge accounts can't register a domain from
      the Stripe Dashboard. Idempotent — safe to re-run.

### Still outstanding for this shop
- [ ] **Submit `acombmegachippy.uk` to Google Search Console** + the sitemap. The
      old agency sites (`acombmegachippy.com`, `acombmegachippyyork.co.uk`) are not
      ours and can't be redirected, so ranking is rebuilt via the Business Profile.
- [ ] **Move the fleet onto the 2026 release keystore.** The signing key is now
      `~/Desktop/lumipos-release-2026.jks`, alias `lumipos`, CN=Lumin Labs, created
      2026-09-09 with its password in a password manager. Verify any APK before
      taking it to a shop:

      ```
      export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
      "$JAVA_HOME/bin/keytool" -printcert -jarfile <app-release.apk> | head -6
      ```

      It replaces two dead ends: `lumipos-release.jks` (29 Jul) whose password is
      lost, so nothing can ever be signed with it again, and the MacBook's
      `~/.android/debug.keystore` (copy at `~/Desktop/lumipos-debug-BACKUP.keystore`)
      which tied updates to one laptop.

      **Changing key means an uninstall.** A till cannot be updated in place across
      different signing keys — it is uninstall, install, re-provision, PIN. So each
      till moves over once, while its shop is closed, never mid-service. Big Bites
      moved 2026-09-09 (the caller-ID build). Rico's, Acomb and One Sip are still on
      their old keys and will each need the same treatment on their next native
      rebuild — which is rare, since Capgo carries every web-layer change over the
      air and only native code (printer, drawer, caller ID, card terminal) needs an
      APK at all.

      Keep the new keystore backed up somewhere off that laptop. Losing it puts us
      straight back here.

## Payments — split / part payment
- [x] **Refund an in-person counter-card sale.** `refund.js` + `status.js` now
      accept `paymentMethod === 'counter_card'` (single PI), so a Terminal sale is
      refundable in-app and auto-refunded on cancel. (2026-07 review.)
- [ ] **Refund a split payment.** A split order (`paymentMethod: 'split'`, with
      `payment.parts[]`) still can't be refunded from the till — it carries
      multiple card PIs (one per part). Needs: refund the card part(s) via their
      stored `intentId`, return/adjust the cash part as a manual note, and cap the
      refundable to what was actually taken. Also handle cancelling a split paid
      order (currently it voids without refunding the card part).
- [ ] Split when settling an **existing** unpaid order (currently new sales only).
- [ ] **Per-unit** item splitting (today a multi-qty line is assigned whole).
- [ ] Item split across **more than 2 people**.

## Notes
- Split foundation already shipped: `payment.parts[]` (cumulative), partial card
  charges (`terminal/charge` / `pay.js` `amountP`), Z-report attribution by part.
