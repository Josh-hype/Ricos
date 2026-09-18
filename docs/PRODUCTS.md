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
| `517122` | The Leaf Café & Bistro (LumiWEB) | `https://theleafcafebistro.co.uk` |
| `718559` | Tad Kebab (LumiWEB) | `https://tadkebab.com` |
| `867648` | Dominic Pizza (LumiPOS) | `https://dominicpizza-york.co.uk` |

**Adding a shop with a device means adding it here** — and the host must be the
shop's reachable custom domain, never a `*.pages.dev` (those are firewalled on
this Cloudflare setup and return 403).

### ⚠️ A LumiWEB shop must set `pos.ordersOnly: true`

One APK serves both products, so a Z93 shows the **full EPOS** by default —
counter sale modes and the card-reader tile included. That is wrong for a shop
paying £19 for a website: it is not buying counter sales.

`pos.ordersOnly: true` in that shop's `config.json` hides the counter mode bar
(`templates/staff/index.html:2354`) and the card-reader tile (`:3328`), leaving
the order board the device is actually there for. It is the ONLY thing that
distinguishes the two products in software — there is still no `product` flag,
and nothing else branches.

Forget it and the shop gets an EPOS it hasn't paid for, and staff get counter
buttons that make no sense on a till with no drawer. Mega Chippy has it set;
Acomb Pizza & Kebab did not until it was spotted on the device.

---

## Caller ID — two sources, and the shop's wiring decides which

When the phone rings, the till shows a bar with the number and, if that number
has ordered before, the customer's **name and address** (`/api/staff/customer-lookup`,
the same records as their website account). Collection / Delivery buttons open a
new sale with the caller prefilled.

It is a **centred dialog**, the same shape as the new-order alarm, because that
is the one place on the screen staff already watch. It was a bar along the
bottom until 18 Sep 2026 — the reasoning being that a ringing phone must not
block an order already being taken — but on a T2 on a counter it was simply
missed, and caller ID nobody notices is caller ID you don't have. It keeps the
bar's two safety valves: one tap dismisses it, and it clears itself after two
minutes. It also sits at `z-index` 50 against the alarm's 60, so **an order
already placed outranks a ringing phone** and is still revealed underneath.

### It needs `pos.customerLookup` as well — a number alone is nothing

Getting the number onto the screen is only half of it, and the other half is a
separate flag. **Without `pos.customerLookup: true`** the lookup endpoint 404s,
the call bar reads that as "nobody" and shows bare digits — which is exactly
what Dominic's first live call did, minutes after the hard part started working.

The flag switches on **two** things, and it has to be both or the feature has
nothing to find:

| | |
|---|---|
| the **lookup** | `/api/staff/customer-lookup?phone=…` → name + addresses, most recent first |
| the **remembering** | `rememberContact()` in `functions/_lib/customer.js`, called by `api/order.js` (every website order) **and** `api/staff/counter-order.js` (every phone order typed at the till) |

One function for both callers deliberately: the two must build **one** address
book, keyed by `normalisePhoneKey` so a landline counts — caller ID reports
plenty of those, and the SMS normaliser would have dropped every one.

Two things that are easy to get wrong here:

- **A website order does not update an account unless they were signed in**, and
  an account keyed by **email** is invisible to a phone lookup however many
  orders it has placed. So the website leaves a phone-keyed *contact* record of
  its own — no password, no account, and it never overwrites a name the customer
  set themselves. If they later sign up with that number, signup owns the record
  and their addresses are already in it.
- **A new shop has no phone-order history**, so for the first weeks its website
  is the only thing that can fill the book. Until the website fed it too, caller
  ID on a brand-new install could only ever show numbers staff had already typed
  in by hand.

On for `food-station` and `dominic-pizza`. Every other shop stores nothing.

### Starting the order: "Who's calling?"

Pressing **Collection** or **Delivery** on the call bar asks the question in the
middle of the screen, like an incoming online order does — the caller's name,
one big button per address they have ordered to, and **Take new details** last:

| Tap | What happens |
|---|---|
| a saved address | name, number and that address are filled and the form is submitted for them — straight to the menu, one tap |
| the name *(collection)* | same, with no address to pick |
| **Take new details** | the blank form, with the number kept and the saved addresses no longer offered — they have just said they're wrong |
| **Back** | no sale started; returns to the board |

Only shown when there is something that saves work — a saved address on a
delivery, a name on a collection — and only when the sale was started **from the
call bar**. Everything else opens the details form exactly as before, so a shop
without `pos.customerLookup`, a manually started sale, and walk-in/eat-in are
all untouched.

**Picking an address submits the real form rather than jumping to the menu**, on
purpose: the submit handler is where the delivery fee comes from, and on a
**radius** shop that means asking the server for the band. A shortcut past it
would show £0 delivery on the till while the server recorded the real total —
the exact bug the comment in that handler warns about. It also means one
validation path, and a postcode the server now refuses leaves staff on the
prefilled form with the reason, which is where they can fix it.

The number can come from either source. Everything downstream is identical —
both fire the same `callerId` event.

| | **USB modem** | **FRITZ!Box call monitor** |
|---|---|---|
| For | an analogue line with CLI on it | a handset plugged into the **router's FON port** |
| Hardware | a USB fax modem in the till's USB port | none — the router already does it |
| Config | none; `native.js` starts it on boot | `pos.callerId: { mode: "fritzbox" }` |
| How | CDC-ACM, `AT+VCID=1` / `AT#CID=1`, parses `NMBR=` | plain TCP to port 1012, parses `;RING;` lines |

**Pick by where the handset plugs in.** If it goes into the router, there is no
analogue pair for a modem to tap and a USB modem will see nothing at all —
Dominic Pizza is wired that way.

### Setting up the FRITZ!Box route

1. `pos.callerId: { mode: "fritzbox", host: "<router LAN IP>" }` in the shop's
   `config.json`. **Set `host` — don't rely on the fallback.** It is nominally
   optional (the plugin reads the till's DHCP gateway, which on a shop LAN is
   usually the router), but two things bite:
   - the till is often on a **separate access point / WiFi box** while the
     handsets hang off the FRITZ!Box, so the till's gateway isn't the FRITZ!Box
     at all — Dominic Pizza is wired exactly that way;
   - the lookup needs `ACCESS_WIFI_STATE`, and an APK built before
     17 Sep 2026 doesn't declare it (see below).

   An explicit host skips the lookup entirely, so it works on any APK.
   **Measure it, don't assume `192.168.178.1`:** on a Mac on the shop's wifi,
   `route -n get default | grep gateway`, then prove the router half before
   touching the till —
   `nc -v <router IP> 1012` should connect and print `;RING;` lines when the
   shop's phone is called.
2. **Dial `#96*5*` from a handset connected to the FRITZ!Box.** This is what
   opens port 1012; nothing works without it. Survives reboots, not a factory
   reset. `#96*4*` turns it off.
3. **Build and install an APK.** Caller ID is native code — Capgo carries web
   changes over the air but *not* this. Do it at install, before the till goes
   on the counter: changing signing key later means uninstall, reinstall,
   re-provision (see `docs/TODO.md`).

Only `RING` opens the bar. `CALL` is an *outgoing* call, and popping the
incoming-call bar when staff dial a customer would be worse than useless.
A withheld number arrives as an empty field and is ignored rather than opening
an empty bar. The socket reconnects with a backoff, because the router drops
every connection when it reboots.

### Big Bites: caller ID is UNRESOLVED, and why

Recording this because it was lost once and cost an argument. Big Bites took the
caller-ID APK on **9 Sep 2026** (`docs/TODO.md`, the keystore migration), which
at that date carried exactly **one** source: a USB modem. That build's own
commit says it was "still unproven against hardware" and "may still not be
enough" — the chipset was never confirmed, because the T2 has no Play Store to
install a terminal app on.

It did not produce a number, and the investigation went to the router and
stopped at not being able to log in. **That was the wrong thing to be stuck on.**

**The router question was finally answered on 18 Sep 2026: a BT hub, with the
handset plugged into it.** So:

- **The FRITZ!Box call monitor is out.** That is an AVM feature; a BT hub has no
  port 1012 and nothing equivalent. This half of the wall was real.
- **But the USB modem should still work — from the RIGHT socket.** BT Digital
  Voice terminates the line in the hub and converts it back to analogue on the
  hub's phone port, CLI included, which is how customers' existing
  caller-display handsets keep working after migration. **The wall sockets are
  dead.** If that modem was plugged into a wall socket — the obvious place to
  put it, and where a pre-switchover install would have gone — it was listening
  to a dead pair, which looks identical to "caller ID doesn't work".

So the leading hypothesis is a **£3 phone splitter**: handset and modem both on
the hub's phone port. Unverified against their hardware, but cheap to test and
the diagnostic below tells you which branch you are on before anyone buys
anything.

What has changed since, and it is not small:

- **The FRITZ!Box route did not exist in September.** It was written on 17 Sep
  (`e1f746b`) for Dominic Pizza. On 9 Sep there was nothing to try but the modem.
- **`#96*5*` is dialled on a handset**, so the router login that blocked Big
  Bites is not needed at all — on a FRITZ!Box.
- **The on-till diagnostic did not exist.** Dominic would have failed the same
  way without it: working router, open port, correct APK, nothing on screen. One
  read of that panel named the cause (`ACCESS_WIFI_STATE`).

So it was a real wall, made of code that had not been written and a device
nobody could see inside. Both are fixed. What remains is a fact about their
building:

**Read the tile before buying or building anything.** It splits the two
possibilities that September could not tell apart:

| Back Office → Caller ID says | Means | Next |
|---|---|---|
| **USB modem running: no** | the modem is not detected at all | unplugged, wrong USB port, or an unsupported chipset — the 9 Sep commit flagged FTDI/Prolific/Silabs/CH340 bridges as only partly handled, since their baud setup is chip-specific and is not sent |
| **USB modem running: yes**, log empty | the modem is healthy and **the line into it is silent** | the dead-wall-socket case. Move it to the hub's phone port on a splitter |
| lines in the log, no call bar | the line reaches the till | the fault is ours, and the log has what is needed to fix it |

**No new APK is needed to read that.** The tile is web layer, delivered by Capgo,
and `getCallerIdLog` has been in their APK since the 9 Sep build — so the thing
that was missing in September is already sitting on their counter.

For any OTHER shop, the router question still comes first, and the answers run:
FRITZ!Box → what Dominic has, needs a new APK for the native call monitor;
analogue line with CLI, or an ISP hub with an analogue phone port → the USB
modem from that port; anything with no analogue port at all → neither route
exists today.

### When it doesn't pop up

**Read it on the till: Back Office → Caller ID.** Configured source, whether
either listener is running, the `host:port` it is talking to, every line it has
seen, and a button to start the call monitor there and then. The tile only
appears in the app (it is gated on the native plugin), which is the point — no
USB cable, no `chrome://inspect`, no Developer options, none of which are
available on a Sunmi T2 in a shop.

What the log tells you:

| It says | Meaning | Fix |
|---|---|---|
| `!! gateway lookup failed: … ACCESS_WIFI_STATE` | the APK predates 17 Sep 2026 and cannot read the DHCP gateway, so it never opened a socket | set `pos.callerId.host` — **no APK needed** |
| nothing at all, `Call monitor running: no` | the config hadn't arrived when the app booted | restart the app, or tap the button |
| `!! call monitor: ConnectException` | the till cannot reach `host:1012` — wrong host, wifi client isolation, or a different network from the router | router side, no code |
| `== call monitor connected` then `;RING;` lines | the line is reaching the till and the fault is downstream | ours |

That first row was a real evening on Dominic's install: `dhcpGateway()` calls
`WifiManager.getDhcpInfo()`, which **throws** without
`android.permission.ACCESS_WIFI_STATE`. The permission was missed when the call
monitor went in; `app/scripts/inject-native.mjs` now declares it alongside the
USB-host feature, so any APK built since carries it. Nothing failed loudly —
the plugin caught the throw, returned `reason: "no-host"` and sat silent, which
from the counter looks identical to "caller ID doesn't work".

The same values are available programmatically:

```js
EPOSNative.getCallerIdLog()   // every line either source has produced,
                              // plus running / callMonitor / callMonitorHost
EPOSNative.startCallerId()    // USB path: lists every attached device
```

`getCallerIdLog()` answers for both sources, so it is the one place to look.
Port 1012 is unauthenticated and LAN-only by design, so anyone on the shop's
wifi can see call events — worth knowing, not worth worrying about on a
takeaway's network.

---

## Who is on what today

| Shop | Slug | Product | Weekly | Device |
|---|---|---|---|---|
| Rico's Peri Peri | `ricos` | LumiPOS | £35 (itemised) | Sunmi T2s |
| Big Bites, Easingwold | `food-station` | LumiPOS (all-in rate) | £19 | on site — **model not recorded, confirm and fill in.** Caller ID unresolved, see below |
| Mega Chippy, Acomb | `mega-chippy` | **LumiWEB** | £19 | ZCS Z93 |
| One Sip | `one-sip` | LumiPOS, till-only (no website, no Stripe) | £0 — family venue, provided free | not provisioned in `provision.js` |
| The Grub Hub | `grub-hub` | LumiPOS | £35 | pre-launch |
| Acomb Pizza & Kebab House | `acomb-pizza-kebab` *(pre-launch — awaiting Stripe Connect)* | **LumiWEB** | £19 | Z93 to supply |
| Dominic Pizza | `dominic-pizza` *(pre-launch — site is still a copy of Acomb's, awaiting rebrand + Stripe Connect)* | **LumiPOS** | ~£35 | Sunmi T2 |

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
| Charging a shop | `docs/BILLING.md`, `tools/setup-billing.mjs` |
| Adding a shop | `docs/ADDING_A_SHOP.md`, `docs/SHOP_CHECKLIST.md` |
| Card terminal (Phase 3) | `docs/PHASE3_TERMINAL.md` |
