# TODO / backlog

Running list of agreed follow-ups. Newest at the top.

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
