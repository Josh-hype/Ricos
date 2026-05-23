# Restaurant onboarding — info we need from you

Welcome! This form gathers everything we need to build your ordering
website. Take ~15 minutes to fill it in and reply with the answers
(plus the logo / photos as email attachments).

If you're not sure on any field, leave it blank and we'll follow up.

---

## 1. Business basics

| Field | Your answer |
|---|---|
| Trading name (what customers see, e.g. "Pizza Bob's") | |
| Short name (casual form for headers, e.g. "Pizza Bob's" or just "Bob's") | |
| Legal company name (as on Companies House) | |
| Companies House number | |
| Address line 1 | |
| City / town | |
| Postcode | |
| Country | |
| Phone number (the one customers should ring with questions) | |
| Orders email address (e.g. orders@yourshop.co.uk) | |

---

## 2. Domain (your website address)

| Field | Your answer |
|---|---|
| Domain you'd like customers to use (e.g. `pizzabob.co.uk`) | |
| Do you already own this domain? (yes / no — if no, we can register one for you) | |
| Where is the domain's DNS managed? (e.g. GoDaddy, 123-reg, Cloudflare, "no idea") | |
| Are you happy for us to manage the DNS for you? (saves us emailing you records to add) | |

---

## 3. Branding

Attach with your reply:

- [ ] **Logo file**: PNG with transparent background. Square if
      possible, at least 512×512 pixels. If you only have a print logo
      / business card, send what you have and we'll work with it.

| Field | Your answer |
|---|---|
| Primary brand colour (the dominant colour — give us a hex code like `#c8261c`, or describe e.g. "deep red") | |
| Accent colour (a second highlight colour — same format) | |
| Background colour, if you want one (defaults to a warm cream) | |
| Optional: a one-line tagline for your landing page (e.g. "Char-grilled chicken, family-run, since 2024") | |

---

## 4. Opening hours

For each day, tell us either the open/close times or "closed":

| Day | Opens | Closes |
|---|---|---|
| Monday | | |
| Tuesday | | |
| Wednesday | | |
| Thursday | | |
| Friday | | |
| Saturday | | |
| Sunday | | |

If you stay open past midnight (e.g. close at 1am Saturday), write the
close time as e.g. "1am Sunday" — we'll set it up correctly.

| Field | Your answer |
|---|---|
| How many minutes before closing should we stop taking online orders? (so the kitchen isn't slammed at the bell, e.g. "30 minutes") | |
| How long does an order typically take to prepare? (we use this for the "ready in about X minutes" estimate) | |

---

## 5. Collection and delivery

| Field | Your answer |
|---|---|
| Do you offer **collection**? (yes / no) | |
| Do you offer **delivery**? (yes / no) | |

If you offer delivery:

| Field | Your answer |
|---|---|
| Delivery fee charged to the customer (in £, e.g. £2.00) | |
| Minimum order value for delivery (in £, e.g. £15) | |
| Which postcode areas do you cover? Give us the outcodes — the bit before the space (e.g. "YO1, YO10, YO23, YO24") | |
| Short description of your delivery area for error messages (e.g. "inside the York ring road" or "within 3 miles of the shop") | |

---

## 6. Your menu

List your full menu, grouped by category. For each item include the
**name**, **price** (in £), and a short **description** (1 sentence).
Photos are optional but make a big difference — see below.

**Format example:**

```
SIGNATURE CHICKEN  (emoji: 🍗)

- Signature Peri Thighs ×3 — £10.95
  3 char-grilled peri thighs in your spice.
  Spicy: yes
  Meal upgrade: + 2 sides & drink, +£4.00

- Half Chicken — £9.95
  Half a peri-marinated chicken, char-grilled.
  Spicy: yes
  Meal upgrade: + 2 sides & drink, +£3.00

SIDES  (emoji: 🍟)

- Chips (Regular) — £2.90
- Coleslaw — £2.60
```

Notes:
- **Categories** — give each one a short name and a single emoji for
  the menu icon
- **Spicy** items get a flame icon on the customer's view; non-spicy
  items don't ask for a spice level
- **Meal upgrade** is optional — for items where customers can add
  "+ sides & drink" for a small extra charge
- **Photos** — if you have item photos, attach them as JPGs. Naming
  them after the item helps (e.g. "half-chicken.jpg"). Square crops
  work best. We'll embed them into the menu page.

| Field | Your answer |
|---|---|
| Your menu | (paste or attach) |
| Photos to attach? (yes/no, how many) | |

---

## 7. Payments

We use Stripe to process card payments — they're the same provider
behind most takeaway apps. Payments land directly in your bank account
(not ours); we just take a small per-order platform fee.

We'll send you a **Stripe Connect onboarding link** separately. You'll
need to:

- [ ] Click the link and fill in business name, address, and your bank
      details (Stripe handles all the card-handling security; we never
      see your customers' card numbers)
- [ ] Upload an ID document if Stripe asks
- [ ] Send us the `acct_xxx` code Stripe gives you at the end

| Field | Your answer |
|---|---|
| Do you also want to accept **cash on collection**? (yes / no) | |
| Do you also want to accept **cash on delivery**? (yes / no) | |
| Stripe Connect ID (the `acct_xxx` code — fill in after onboarding) | |

---

## 8. Kitchen setup

When orders come in, your kitchen staff will see them on a "staff
page" — basically a live list of new orders that beeps when a new one
arrives. This works in any web browser.

| Field | Your answer |
|---|---|
| What device(s) will the kitchen use to see orders? (e.g. iPad, wall-mounted TV with Fire Stick, old laptop, your existing till PC) | |
| Do you want a printer too? (we can support adding a thermal receipt printer later — extra cost ~£150 hardware) | |
| Phone number that should receive an SMS for each new order (optional but useful as a backup) | |

---

## 9. Marketing

We can collect customer emails / mobile numbers (opt-in only) so you
can send promotions later. You don't have to use this — just tells us
whether to show the opt-in tickboxes at checkout.

| Field | Your answer |
|---|---|
| Show "Email me about offers" tickbox at checkout? (yes / no) | |
| Show "Text me about offers" tickbox at checkout? (yes / no) | |

---

## 10. Anything else

| Field | Your answer |
|---|---|
| Anything specific about how you'd like the site to look or work? | |
| Any features you've seen elsewhere that you'd want? (we'll let you know if it's possible) | |
| When would you ideally like to be live? | |

---

## What happens next

Once you send this back along with the logo + photos + your Stripe
Connect `acct_xxx`:

1. We build your site (~1 working day)
2. We send you a test link so you can place a few practice orders
3. You point your domain at us (or we do it if you've given us DNS
   access)
4. We do a final round of testing on the live domain
5. You're live — start taking orders

Reply with the filled-in form and attachments, or send any questions
back our way.
