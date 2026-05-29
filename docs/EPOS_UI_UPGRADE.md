# EPOS UI Upgrade — research synthesis & plan

> Source: 11 parallel UI/UX research agents studying the best EPOS/POS interfaces
> (Toast, Square for Restaurants, Lightspeed, TouchBistro, SumUp, Zettle, Loyverse,
> Clover, Shopify POS, Revel, Lavu) + platform/accessibility standards (Apple HIG,
> Material, NN/g, WCAG, Stripe/fintech design). Target: the touch counter EPOS on
> the Sunmi T2 (landscape), built in the "Lumin" design language.

The findings converged hard — the same moves recurred across domains. This doc is
the deduped, prioritised plan and the changelog of what's shipped.

---

## ✅ Pass 1 — applied (design tokens, typography, touch, feedback)
Shipped to `templates/staff/index.html` (cascades across the whole till):
- **Darker secondary text** for contrast — `--muted` `#7488A0`→`#5C6B82`, `--muted-2`→`#8090A6` (clears WCAG AA on white; the old greys failed).
- **Accent discipline** — added `--accent-strong: #0059C2` (the darker blue for small text / borders / focus, since `#0070F0` is only 4.59:1 on white). Active **category chip is now solid blue** (was dark ink).
- **Bigger touch targets** — qty steppers **26px → 40px** with a real gap (was the worst offender), Charge button **60 → 64px**, remove-(×) hit area enlarged, catalog tiles `minmax(132→150px)`.
- **Typography / numbers** — ticket line names & prices **13.5 → 16px**, modifiers **11.5 → 13px**, tile name/price **→ 15px**, **grand total 19 → 24px**, `tabular-nums` on all money so digits align, hairline (not dashed) total divider.
- **Press feedback & motion tokens** — added `--ease-out` + `--motion-fast`; chips/qty buttons get an `:active` press state (touch has no hover).

## 🔜 Queued — bigger, higher-effort passes (recommended order)
2. **Sticky ticket footer + Charge-with-amount.** Make the ticket = scrolling lines → **sticky totals** → **sticky `Charge £24.50` bar** (amount on the button); page never scrolls, Charge never moves. *(layout/IA + ticket + payment agents)*
3. **Category colour-coding** — per-category accent (config in `menu-visual.json`) as a stripe on chips + tiles; reserve blue for "the action" only. Replace the vague "⋯" options badge with an explicit options pill + outline. *(visual + menu)*
4. **Modifier modal → chips, not dropdowns** — spice/side/drink become big tappable chips; required-first; inline validation (scroll-to-error, not a dead button); auto-progress; live total on "Add to order · £X". *(modifier agent)*
5. **Payment redesign** — tender picker (Cash/Card/Split/Other) first; **UK quick-cash buttons** (Exact·£10·£20·Next £5); colour-coded change (green/amber); amount-stamped confirm; over-tender guard; success card leads with **"Give change £4.20"**. *(payment agent — overlaps the Band-2 payment feature work)*
6. **Live view as Kanban + smart cards** — columns (New·In Prep·Ready·Out for Delivery); card hierarchy (order# + channel badge + age timer / items / next-action ≥56px); **ageing colour thresholds** tied to ready time; count-up + count-down timers; looping new-order alarm; recall/undo. Today = hero KPI tiles; Z report = grouped tabular sections + "cash expected in drawer". *(live-orders agent)*
7. **Status = colour + icon + word** everywhere (CVD-safe blue/amber/green/red; red reserved for destructive only). *(legibility agent)*
8. **Micro-interactions** — optimistic add with line slide-in + total count-up bump; payment button 3-state machine (label→spinner→✓); skeletons for menu load; one-toast-at-a-time undo snackbars; `prefers-reduced-motion` + optional haptic/sound on commit. *(micro-interactions agent)*
9. **Onboarding/flows** — persistent 3-step stepper (Mode›Customer›Items›Pay, tappable back without wiping); "Continue as walk-in" big card; recoverable decline/offline states; helpful empty states. *(onboarding agent)*

## 🧱 Foundational (do alongside #2-3): 3-tier design tokens
Formalise **global → semantic → component** tokens; feed each shop's accent/fonts from
`config.json` into the global layer only, so a reskin is a token swap, not a fork
(honours golden rule #3). Keep the dark rail as the only dark surface; ship a full
dark theme later as a per-device toggle.

---

## The recurring cross-domain consensus (what 3+ agents all said)
1. **Fixed two-pane** (catalog ~63% / ticket ~37%), page never scrolls, ticket footer sticky.
2. **Charge = full-width, amount-on-button, bottom-right, the only saturated blue.**
3. **≥48px touch targets** (56-64 for primary), ≥8px gaps; qty steppers were the #1 problem.
4. **16px text floor**, totals oversized, **tabular numerals**, right-aligned money columns.
5. **Indent modifiers** under items in muted text; auto-merge identical lines.
6. **Active category chip solid blue + pinned; colour-code categories onto tiles.**
7. **Replace dropdowns with big chips** in the modifier sheet; required-first + inline validate.
8. **Status by colour + icon + word**, CVD-safe palette, **red = destructive only**.
9. **Undo snackbars** for reversible slips; **confirm dialogs only** for refund/void.
10. **Instant press feedback (<100ms)**, optimistic add, disable-on-submit (no double-charge).
