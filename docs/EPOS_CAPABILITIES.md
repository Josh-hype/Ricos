# EPOS Capability Map — "Best on the Market" Research

> Source: parallel research across the leading restaurant/takeaway EPOS systems
> (Toast, Square for Restaurants, Lightspeed, TouchBistro, Clover, Revel, Epos Now,
> Lavu, Loyverse, NCR Aloha, Oracle MICROS Simphony, ICRTouch, Tevalis, SumUp,
> Zettle, plus UK ordering/middleware: Flipdish, Slerp, Deliverect, Otter, and
> inventory tools MarketMan/Apicbase).
> Purpose: an inventory of capabilities we can add to make our EPOS best-in-class,
> scoped to our stack (Cloudflare Pages + Functions + Workers KV, Stripe Connect,
> Resend email, Twilio SMS, browser-based till, future Sunmi T2).

**Legend**
- **Tier:** `TS` Table-stakes · `STD` Standard · `PREM` Premium differentiator
- **Fit/Effort:** fit for our stack + rough build size (Low / Med / High)
- **State:** ✅ have · 🟡 partial · ⬜ missing

---

## 0. What we already have (baseline)

- ✅ Counter "Sale" view: walk-in / collection / delivery, menu catalog (categories,
  search, tap-to-add tiles), modifiers / option groups / "make it a meal" combos,
  ticket with qty ±/remove, cash payment (keypad + change), manager-PIN gate on
  financial views, 90s idle revert.
- ✅ Live order view: accept → ready → out-for-delivery → complete; full & partial
  (by-item) refunds.
- ✅ Z report + "Today's summary" (gross, order count, AOV, card vs cash split,
  collection vs delivery counts, refunds).
- ✅ Web online ordering (collection + delivery; outcode OR radius delivery pricing,
  geocoded via postcodes.io), Stripe Connect (per-shop), Apple/Google Pay online,
  customer accounts, automatic 10% online discount (suppressed on counter sales).
- ✅ Server-side pricing authority (`functions/_lib/totals.js`) — never trusts client.
- ✅ KV namespaces: ORDERS, CUSTOMERS, MARKETING, SLOTS, STAFF_LOGIN.
- ✅ Resend (email) + Twilio (SMS) wired.

---

## 1. Order Taking & Menu Engineering

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| Tap-to-add category grid (image tiles, sticky cats, big touch targets) | TS | High/Low | 🟡 |
| Item search / type-ahead | TS | High/Low | ✅ |
| Quick keys / favourites grid (per-shop, most-ordered pinned) | STD | High/Low–Med | ⬜ |
| Modifier groups with **required + min/max** enforcement on the till | TS | High/Low–Med | 🟡 |
| Forced-show / suggestive prompt groups (upsell nudge) | STD | High/Low | ⬜ |
| Default / pre-selected & "NO X"/"EXTRA X" pre-modifiers | STD | Med/Med | ⬜ |
| Combos / meal deals with per-slot choice lists + upsize pricing | STD | High/Med | 🟡 |
| Auto-combo recognition / upsize prompt | PREM | Med/Med–High | ⬜ |
| **Open / misc item** (manual name + price, manager-gated) | STD | High/Low–Med | ⬜ |
| **Item availability / "86" / sold-out** synced to online ordering | TS | High/Med | ⬜ |
| Time-based & multiple menus (breakfast/lunch, happy hour) | STD | Med/Med | ⬜ |
| **Order types eat-in / takeaway / delivery → correct UK VAT** | TS | High/Med | 🟡 |
| Price levels / multi-price per item (eat-in vs takeaway, daypart) | STD | Med/Med | ⬜ |
| Quantity entry (×n, stepper) | TS | High/Low | 🟡 |
| Repeat / duplicate line ("another the same") | STD | High/Low | ⬜ |
| **Voids & corrections with reason codes + manager approval** | TS | High/Med | 🟡 |
| Comps / discounts (line & order level) with reasons | STD | Med/Med | ⬜ |
| **Order-level & line-level notes / special instructions** | TS | High/Low | ⬜ |
| Allergen flags on items (Natasha's Law) | STD | Med/Low–Med | ⬜ |
| **Park / hold & recall multiple open tickets** | TS | High/Med | ⬜ |
| Split bill / split item / split evenly | STD | Med/Med | ⬜ |
| Merge tickets | STD | Med/Low–Med | ⬜ |
| Transfer items between orders | STD | Low–Med/Low–Med | ⬜ |
| Training / practice mode (non-real orders, excluded from Z) | STD | Med/Low | ⬜ |
| PLU code / barcode scanning | STD | Low/Low–Med | ⬜ |
| Weight / scale items | STD | Low/— | ⬜ |
| Course & seat management, hold/fire coursing | PREM | Low/High | ⬜ |

---

## 2. Payments, Tenders & Terminals

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| Cash tender + change due | TS | High | ✅ |
| **Quick-cash denomination buttons** (£5/£10/£20/exact) | TS | High/Low | ⬜ |
| **Card tender (record manually now)** — paid-by-card on existing machine | TS | High/Low | ⬜ |
| In-person card capture via **Stripe Terminal** (server-driven) | TS | High/Med | ⬜ |
| Contactless / Apple-Google Pay at counter (free with reader) | TS | High/Low | ⬜ |
| **Split across tenders** (part cash / part card) | TS | High/Low–Med | ⬜ |
| **Tips / gratuity** (preset % + custom; on-reader prompt) | STD | Med–High/Low | ⬜ |
| Service charge / auto-gratuity (config-flag, per shop) | STD | Med/Low–Med | ⬜ |
| **"Other" tenders** (Deliveroo/Uber settled externally, voucher) | STD | High/Low | ⬜ |
| Comp / staff / discount-to-zero close | STD | Med/Low–Med | ⬜ |
| Small-order / minimum-spend fee (legal in UK) | STD | Med/Low | 🟡 |
| **Refunds & partial refunds from till** (Stripe Refunds API) | TS | High/Low | 🟡 |
| Voids / cancel before capture | TS | High/Low | ⬜ |
| **Receipt at point of payment** (email/SMS via Resend/Twilio; print later) | TS | High/Low | ⬜ |
| Gift card / stored-value tender | STD | Med/Med–High | ⬜ |
| Store credit (refund-to-credit) | STD | High/Low–Med | ⬜ |
| On-account / house accounts tender | STD | Low–Med/Med | ⬜ |
| Partial payments & deposits (catering) | STD | Med/Med | ⬜ |
| Pre-auth / open tabs (bar pattern) | PREM | Low/Med | ⬜ |
| **Pay-at-table / QR-to-pay** (reuse existing web Stripe checkout) | PREM | Med–High/Low–Med | ⬜ |
| Cash rounding rules | STD | Low/— | ⬜ |
| Multi-currency | PREM | Low/— | ⬜ |

> ⚠️ **UK legal:** consumer debit/credit-card surcharges are **banned** (PSR 2017) — do
> not build a card surcharge for UK shops. Minimum-spend / delivery fees are fine.

> 🔌 **Stripe Terminal reader decision (shapes everything):**
> - **Path A — server-driven + smart reader (WisePOS E)** *(recommended)*: no SDK, no
>   `js.stripe.com`, no LAN coupling. Function creates a PaymentIntent (Connect-scoped),
>   calls `process_payment_intent` on the reader; reader handles card/contactless/wallet
>   + on-reader tips; Function captures. Cleanest fit for a Cloudflare browser till.
> - **Path B — JS SDK**: browser drives reader, needs connection token + **same-LAN** as
>   reader (fragile in a shop). More moving parts.
> - **Path C — Tap-to-Pay on the Sunmi T2**: ⚠️ **requires a native Android/RN app — the
>   JS SDK cannot invoke it.** Browser till can't use the T2 as the card reader without a
>   thin native wrapper. Stripe lists Sunmi as a supported Tap-to-Pay partner.
> - Keep **all** payment confirmation server-side; store only PaymentIntent/charge IDs in
>   KV (PCI scope stays minimal — SAQ-A territory).

---

## 3. Cash, Shift & Till Operations

> One unifying model delivers most of this cheaply: a **shift/drawer session** in KV,
> opened with a declared float, with every cash movement stored as an **append-only,
> reason-coded event**, and **expected-vs-counted reconciliation computed server-side**
> next to `totals.js`. (UK vocabulary: "cash up / float / Z report".)

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Opening float / starting-cash declaration** | TS | High/Low | ⬜ |
| **Shift/session lifecycle** (open → trade → close), orders tagged `shiftId` | TS | High/Low–Med | ⬜ |
| **Cash in / pay-in** (reason codes) | TS | High/Low | ⬜ |
| **Cash out / pay-out / paid-out** (reason codes) | TS | High/Low | ⬜ |
| Petty cash / expense categories | STD | Med/Low–Med | ⬜ |
| No-sale / open-drawer event (audit-logged, manager-gated) | STD | Med/Low | ⬜ |
| **Blind cash-up** (withhold "expected" from browser; per-shop flag) | PREM | High/Low | ⬜ |
| **Expected-vs-counted reconciliation + over/short variance** | TS | High/Med | ⬜ |
| **Sales-by-tender breakdown at close** (cash→drawer, card→Stripe) | TS | High/Low | 🟡 |
| **X report** (mid-shift snapshot, non-resetting) | TS | High/Low | ⬜ |
| **Z report** with true reset/lock semantics | TS | High/Med | 🟡 |
| End-of-day procedure & day-close locking | STD | Med/Med | ⬜ |
| Cash drop / safe drop (+ threshold alert) | STD | Med/Low–Med | ⬜ |
| Banking & deposit records | STD | Med/Low–Med | ⬜ |
| **Immutable cash event audit log / drawer history** | STD | High/Low | ⬜ |
| Multiple drawers & per-operator drawer assignment | STD | Med/Med | ⬜ |
| Cashier-banking vs server-banking model | PREM | Med/Low (cashier) | ⬜ |
| Tip declaration & cash-tip handling | STD | Med/Low–Med | ⬜ |
| Reopen / adjust closed shift (audited, reason-coded) | STD | Med/Med | ⬜ |
| Variance trend / loss-prevention analytics | PREM | Med/Med | ⬜ |
| Multi-till consolidation / cash-office roll-up | PREM | Med/Med | ⬜ |

---

## 4. Staff, Access Control & Security

> Everything below is unlocked by one foundational change: **per-operator identity in KV**
> (each operator = name/role/PIN-hash/active). This also closes real PCI DSS 4.0 gaps.

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Individual operator accounts** (per-person identity) | TS | High/Med | ⬜ |
| Per-operator PIN login (hashed, per-operator) | TS | High/Low–Med | 🟡 |
| Fast operator switching at the till | TS | High/Low–Med | ⬜ |
| **Roles with granular permissions** | TS | High/Med | 🟡 |
| Sensitive-action flags (can-void/refund/discount/open-drawer/reports) | TS | High/Med | ⬜ |
| **Manager override / authorise-this-action prompt** (generalise our manager PIN) | TS | High/Low–Med | 🟡 |
| **Sales attribution per operator** (`operatorId` on each order) | TS | High/Low | ⬜ |
| **Full audit trail** of sensitive events (who/when/approver) | TS | High/Low | ⬜ |
| **Idle / session auto-logout** to PIN screen | TS | High/Low | 🟡 |
| **PIN lockout & rate-limiting** on failed attempts (PCI 4.0) | TS | High/Low | 🟡 |
| Role-based access: till vs back-office | TS | High/Med | 🟡 |
| Clock in/out & time & attendance | STD | Med/Med | ⬜ |
| Timecard editing & approval | STD | Med/Med | ⬜ |
| Labour cost vs sales reporting | STD–PREM | Med/Med | ⬜ |
| Tip pooling / distribution by hours | PREM | Low–Med/Med | ⬜ |
| Permission hierarchy / rank (can't grant above your level) | PREM | Low–Med/Low | ⬜ |
| Multi-location staff (one operator across shops) | STD–PREM | Med/High | ⬜ |
| Swipe card / fob / fingerprint login | STD/PREM | Low/— | ⬜ |
| Rotas / scheduling | STD | Low/High (better integrated) | ⬜ |
| Commission / upsell tracking | PREM | Low/— | ⬜ |

---

## 5. Reporting, Analytics & Accounting

> KV is not a query engine — pre-aggregate into daily/period rollup keys at order-close
> (or via a scheduled rollup) so reports stay fast.

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Auto-refreshing live sales dashboard** | TS | High/Low–Med | 🟡 |
| Sales by period (hour/daypart/day/week/month/YoY) | TS | High/Med | 🟡 |
| Daypart breakdown (configurable windows) | STD | Med/Low–Med | ⬜ |
| **Product mix / best & worst sellers** | TS | High/Med | ⬜ |
| Category / menu-group sales | TS | High/Low–Med | ⬜ |
| Menu-engineering quadrant (stars/dogs/…) | PREM | Med/Med | ⬜ |
| Sales by order type (eat-in/collection/delivery) | TS | High/Low | 🟡 |
| Sales by tender / payment method | TS | High/Low | ✅ |
| Sales by operator / till | STD | Med/Med | ⬜ |
| Average order value & covers | TS | High/Low | 🟡 |
| Voids / refunds / discounts report (reasons, who) | TS | Med/Med | 🟡 |
| Hourly heatmap / peak times | STD | High/Low | ⬜ |
| Labour cost vs sales & labour % | STD | Low–Med/High | ⬜ |
| Gross margin / COGS with recipe costing | PREM | Med/Med–High | ⬜ |
| **UK VAT report** (multi-rate, eat-in vs cold-takeaway split) | TS | High/Med | ⬜ |
| **End-of-day financial / flash report** (printable) | TS | High/Low–Med | 🟡 |
| Cash-up / over-short reconciliation report | STD | Med/Med | ⬜ |
| Accounting export (Xero/QuickBooks/Sage CSV; later API) | STD | Med/Med–High | ⬜ |
| **Scheduled report emails** (Cron + Resend) | STD | High/Low–Med | ⬜ |
| **Multi-site consolidated reporting** | PREM | Med–High/Med–High | ⬜ |
| Anomaly / exception alerts (excess voids, big refunds) | PREM | Med/Med | ⬜ |
| Forecasting / trend projection (simple moving-avg) | PREM | Low–Med/Med | ⬜ |
| Exportable CSV / PDF on every report | TS | High/Low (CSV) | ⬜ |
| Custom report builder | PREM | Low/High | ⬜ |

---

## 6. CRM, Loyalty, Promotions & Marketing

> 🌟 **Our biggest structural advantage:** website + till share one codebase, one KV
> store, and one `totals.js`, so a **unified customer + loyalty balance across web and
> counter** is *easier* for us than for vendors stitching two systems together.
> ⚠️ Reconcile loyalty with the existing **10% online discount** (don't double-reward).
> ⚠️ **GDPR/PECR consent capture is a hard prerequisite** before any marketing send.

| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Customer profiles & order history** (visits, LTV, prefs) | TS | High/Med | 🟡 |
| **Customer lookup at till** (phone/email/QR; KV secondary index) | TS | High/Low–Med | ⬜ |
| **Attach customer to sale** | TS | High/Low | ⬜ |
| Points-based loyalty (earn per spend/visit/item) | TS | High/Med | ⬜ |
| Visit-stamp / punch-card loyalty | STD | High/Low | ⬜ |
| Spend-based tiers / VIP | PREM | Med/Low–Med | ⬜ |
| **Rewards redemption at till** (via `totals.js`, atomic) | TS | High/Med | ⬜ |
| Digital & physical gift cards | STD | Med/Med–High | ⬜ |
| Store credit | STD | High/Low–Med | ⬜ |
| Gift card / balance lookup | TS | High/Low | ⬜ |
| **Vouchers / coupons / promo codes** (single/multi-use, QR) | STD | High/Med | 🟡 |
| Automatic / rule-based discounts (happy hour, meal deal, BOGOF) | STD | Med/Med–High | 🟡 |
| Staff / comp discounts (tracked) | STD | Med/Low | ⬜ |
| **Manual discounts at till** (line & order level) | TS | High/Low | ⬜ |
| **Manager-gated discounts + reason codes** | STD | High/Med | 🟡 |
| On-account / tabs / corporate + invoicing | PREM | Low–Med/Med–High | ⬜ |
| Email marketing campaigns + segmentation (Resend) | STD | High/Med | 🟡 |
| SMS marketing campaigns (Twilio) | STD | High/Med | 🟡 |
| **Lifecycle messages** (welcome / win-back / birthday) via Cron | PREM | High/Med | ⬜ |
| **GDPR consent capture** (email/SMS, timestamp, source, STOP) | TS | High/Low–Med | ⬜ |
| Review / feedback capture & reputation (route 4–5★ to Google) | STD | Med/Low–Med | ⬜ |
| Referral schemes | PREM | Med/Med | ⬜ |
| Unified earn/redeem across web + counter | PREM | High/Med | ⬜ |

---

## 7. Kitchen, Delivery & Omnichannel

### Kitchen
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| Digital order tickets / KDS grid | TS | High/Low–Med | 🟡 |
| Bump & recall | TS | High/Low | 🟡 |
| **Colour-coded prep timers / SLAs + audible alert** | TS | High/Low | ⬜ |
| Item routing to prep stations | STD | Med/Med | ⬜ |
| Expediter / pass screen | STD | Med/Low | ⬜ |
| All-day / production item counts | STD | Med/Med | ⬜ |
| **Order-ready notification** (SMS/email on ready) | STD | High/Low | ⬜ |
| Kitchen / prep printing + reprint | TS | Low/Med–High (print bridge) | ⬜ |
| Multiple synced prep screens / assembly-line bumping | STD | Med/Med–High | ⬜ |
| Course firing / hold-and-fire | STD/PREM | Low/High | ⬜ |

### Delivery & Dispatch
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Delivery zone mapping** (radius bands/polygon, per-zone fee & min) | STD | High/Low–Med | 🟡 |
| **On-demand courier network** (Uber Direct / Stuart API) | STD | High/Med | ⬜ |
| In-house driver management & assignment | STD | Med/Med | ⬜ |
| **Dispatch board** (status/driver/ETA; filtered order view) | STD | High/Low–Med | ⬜ |
| Live driver tracking + customer ETA link (via courier) | STD | High/Low (courier) | ⬜ |
| Proof of delivery (photo/sig/GPS) | STD | Low–Med/Med | ⬜ |
| Batch / route multiple drops | PREM | Low/High | ⬜ |

### Omnichannel
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| First-party web ordering (collection + delivery) | TS | High | ✅ |
| **Unified channel-tagged order feed** (one queue, `channel` tag) | STD | High/Low | 🟡 |
| **Busy mode / dynamic prep-time bump** | STD | High/Low | ⬜ |
| **Pause channel / 86 item across channels** | TS | High/Low | ⬜ |
| **Order throttling / pacing** (cap per time slot) | STD | High/Low | ⬜ |
| **Scheduled / pre-orders** (capacity-aware slots) | STD | High/Med | 🟡 |
| Aggregator integration & menu sync (Deliveroo/UberEats/JustEat via Deliverect/Otter) | STD | Med–High/Med | ⬜ |
| Self-order kiosk (order.html in kiosk mode + reader) | STD | Med/Med | ⬜ |
| QR-at-table ordering & pay | STD | Med/Med | ⬜ |
| Branded PWA app (web push, Apple/Google Pay) | PREM | Low–Med/Med (PWA) | ⬜ |
| WhatsApp / social ordering (deep link → bot) | PREM | Med/Low (link)–High (bot) | ⬜ |

---

## 8. Inventory, Hardware & Platform Robustness

### Inventory / Stock
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Item-level stock count & live depletion** | TS | High/Low | ⬜ |
| **Low-stock alerts** (Resend/Twilio) | TS | High/Low | ⬜ |
| **Auto-86 at zero** (till + online, server-gated) | TS | High/Low–Med | ⬜ |
| Waste / spoilage tracking (reason codes) | STD | High/Low | ⬜ |
| Stocktake / count screen (+ offline auto-save) | STD | High/Med | ⬜ |
| Recipe / ingredient (BOM) depletion | STD | Med/Med | ⬜ |
| Par levels & suggested reorder list | STD | Med/Low–Med | ⬜ |
| COGS / recipe costing & gross margin | STD | Med/Med–High | ⬜ |
| Theoretical-vs-actual usage / variance (capstone) | PREM | Med/High | ⬜ |
| Supplier management & purchase orders | STD | Low–Med/Med–High | ⬜ |
| Goods-in / receiving (+ OCR invoice) | STD/PREM | Low/Med–High | ⬜ |
| Multi-location stock (read-only cross-shop view) | STD | Med/Med | ⬜ |
| **Allergen & nutrition data (Natasha's Law)** | STD (TS in UK) | High/Low–Med | ⬜ |

### Hardware / Peripherals
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| Sunmi T2 all-in-one (till + printer + CFD + drawer) | TS | High | 🟡 |
| Receipt print via **Star CloudPRNT** (server-driven poll) | STD | High/Med | ⬜ |
| Receipt print via Epson ePOS (LAN, JS SDK) | STD | Med/Med | ⬜ |
| Sunmi built-in printer (native wrapper / WebView bridge) | TS (Sunmi) | High (wrapper)/Med | ⬜ |
| Plain browser print (window.print + CSS) fallback | TS | High/Low | ⬜ |
| Kitchen printer routing | STD | Med/Med | ⬜ |
| Cash drawer kick (via printer ESC/POS or T2 port) | TS | High/Low | ⬜ |
| Label printer (date/allergen/PPDS) | STD | Med/Med | ⬜ |
| Customer-facing display (T2 rear screen) | STD | Med/Med | ⬜ |
| Stripe Terminal reader pairing (WisePOS E / Tap-to-Pay) | STD | Med–High/Med | ⬜ |
| Barcode / QR scanner (T2 camera) | STD | Low–Med/Low–Med | ⬜ |
| Handheld / tablet ordering (responsive web = free) | STD | High/Low | 🟡 |
| Weighing scales | PREM | Low/— | ⬜ |

### Platform
| Capability | Tier | Fit/Effort | State |
|---|---|---|---|
| **Offline / poor-connectivity till** (PWA + IndexedDB outbox + idempotent replay) | TS (PREM for web) | High/Med | ⬜ |
| Cloud back-office / remote management | TS | High/Low–Med | 🟡 |
| Central menu/price management with runtime push (KV editor, no redeploy) | STD | Med/Med | ⬜ |
| Multi-location management (cross-shop admin/reporting) | STD | Med/Med | ⬜ |
| App / auto updates (SW update flow, no stale cache) | TS | High/Low | 🟡 |
| Data backup & durability (periodic export to R2) | TS | Med/Med | 🟡 |
| Uptime / graceful dependency fallback (Stripe/Resend/Twilio) | TS | High/Med | 🟡 |
| Security / PCI (card data stays in Stripe; no PANs in KV) | TS | High (inherited) | ✅ |
| API / webhooks for our own integrations | STD | Low–Med/Med | 🟡 |

#### Offline strategy for a browser till (recommended recipe)
1. Make the till a **PWA**; service worker pre-caches app shell + current menu, with an
   explicit "new version" update flow (`skipWaiting`) so the cache never pins a stale
   build (we've been bitten by stale builds before).
2. Queue sales in **IndexedDB** ("outbox") with a **client-generated UUID** + schema
   version; show "pending sync" in the UI.
3. On reconnect, **replay idempotently** — the UUID is the idempotency key; the order
   Function treats a repeat as a no-op (guards against double-charge). Delete from
   outbox only after server ack.
4. Retry with backoff; use Background Sync where available but always also drain on
   `online`/focus (Safari/iOS lacks Background Sync; ITP can evict IndexedDB ~7 days).
5. Scope offline to **order capture + cash** first; defer offline **card** (PCI-sensitive;
   with Stripe, require connectivity for card). Fall back to the T2 local printer when
   CloudPRNT can't reach the network.

---

## 9. Cross-cutting strategic decisions & caveats

1. **Keep `totals.js` the single pricing authority** — every new money feature (discounts,
   loyalty redemption, combos, open price, VAT, service charge) computes server-side.
   Never trust client totals.
2. **Per-shop config flags, never forks** (golden rule #3) — blind-close, service charge,
   loyalty scheme type, busy mode, etc. ship to everyone, render where enabled.
3. **KV ≠ query engine** — pre-aggregate rollups for reporting; use secondary index keys
   for customer/gift-card lookup; use append-only event lists for audit/cash.
4. **UK compliance is not optional:** VAT (hot vs cold takeaway, eat-in), Natasha's Law
   allergens, GDPR/PECR marketing consent, no consumer card surcharge, PCI (keep cards
   in Stripe).
5. **Sunmi T2 reality check:** great all-in-one, but **Tap-to-Pay needs a native Android
   wrapper** — a pure browser till can't drive it as a card reader. Decide
   wrapper-vs-pure-PWA early; it affects card capture, built-in printer, and CFD.
6. **Real-time across screens:** KV is not push. Polling is the cheap interim; Durable
   Objects / WebSockets are the upgrade if we want true multi-screen KDS sync.

---

## 10. Suggested build order (opinionated)

**Tier 1 — Counter essentials & quick wins (high value, low/med effort, no new hardware)**
- Quick-cash buttons; **card tender (manual)**; tips; "other" tenders; receipts (email/SMS)
- **Park/recall multiple tickets**; quantity ±; duplicate line; line/order notes
- **Voids/comps & manual discounts with reason codes** (reuse manager PIN)
- Required/min-max modifier enforcement; **open/misc item**
- **86 / item availability** synced to online; busy mode; pause channel; throttling
- Colour-coded prep timers + bump/recall polish; order-ready SMS

**Tier 2 — Money discipline & identity foundations**
- **Shift/drawer session + float + cash in/out + X report + blind cash-up + reconciliation**
- **Per-operator identity → roles/permissions → manager-override → sales attribution → audit log**
- Idle auto-logout + PIN lockout (PCI)
- **Order types → correct UK VAT** in `totals.js`; UK VAT report; richer end-of-day report

**Tier 3 — Growth differentiators (our architecture shines)**
- **Unified customer + loyalty (points or stamps) across web + counter**, redemption via
  `totals.js`; vouchers/promo codes; GDPR consent; lifecycle messages (Cron); review capture
- Reporting suite: product mix, category, dayparts, hourly heatmap, scheduled emails,
  multi-site consolidated view
- Item-level stock + low-stock alerts + auto-86 + waste + allergen data

**Tier 4 — Hardware & external integrations (decision/lead-time dependent)**
- **Stripe Terminal** (server-driven + WisePOS E) **or** pay-at-table QR; cash-drawer kick;
  receipt printing (CloudPRNT/Sunmi); CFD
- **Offline PWA** (order capture + cash)
- On-demand couriers (Uber Direct/Stuart); aggregator middleware (Deliverect/Otter)
- Recipe/BOM costing + theoretical-vs-actual variance; accounting export; self-order kiosk

**Defer / low-fit:** course & seat management, hold/fire coursing, weight/scale items,
barcode-heavy retail flows, route-batch optimisation, native mobile app, on-account/tabs &
pre-auth (unless catering/B2B demand), custom report builder, biometric/card login.
