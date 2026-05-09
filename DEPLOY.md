# Deploying Rico's Peri Peri

End-to-end guide for taking the site from this repo to a live domain serving real orders. Estimated time: 60–90 minutes spread across a few service signups.

> Before you start, gather: your limited company name + Companies House number, UK business bank account details, the domain you own (and where it's registered), and a phone number for the tablet/staff.

---

## 0. Branch protection and the staging flow

The default branch is `main`. Cloudflare Pages auto-deploys it. Develop on feature branches, open pull requests, merge to deploy.

For this initial launch we'll build everything once, then merge.

---

## 1. Cloudflare account + Pages project

1. Sign up / sign in at https://dash.cloudflare.com (free plan is fine).
2. **Workers & Pages → Create → Pages → Connect to Git** → pick the GitHub repo `Josh-hype/Ricos`.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
   - **Root directory:** `/`
4. Click **Save and Deploy**. The first deploy will produce a `*.pages.dev` URL that *partially* works — the API endpoints will 500 until the KV bindings and secrets are in place (next steps).

## 2. KV namespaces

Pages Functions need four KV namespaces. Create them once:

```sh
npx wrangler login
npx wrangler kv namespace create ORDERS_KV
npx wrangler kv namespace create MARKETING_KV
npx wrangler kv namespace create SLOTS_KV
npx wrangler kv namespace create STAFF_LOGIN_KV
```

Each command prints an `id`. In the Cloudflare dashboard, go to **your Pages project → Settings → Functions → KV namespace bindings** and add four bindings, matching the names above to the ids you just created. (Or paste them into `wrangler.toml` and let CI deploy from there.)

## 3. Stripe (Connect)

This site charges customers a £0.35 platform service fee on top of every order. That fee flows to a **platform Stripe account** (your developer entity) via Stripe Connect, with the rest going to the **venue's connected account** (RICOS CHICKEN LIMITED). Architecture:

```
customer card  →  PaymentIntent on venue's connected account
                ├──  £14.86  →  RICOS CHICKEN LIMITED Stripe balance (food + delivery)
                └──   £0.35  →  YOUR PLATFORM Stripe balance (application_fee_amount)
```

You only need this set up once — every future venue you onboard becomes another connected account under the same platform.

### 3a. Register your platform legal entity

The platform Stripe account **cannot** be the same legal entity as the venue. Do these in order:

1. **Companies House → Register a new limited company** (≈£12, usually approved same-day).
   Suggested name: anything like *"Josh Tech Ltd"*, *"\<Yourname\> Software Ltd"*, etc. You're the sole director.
2. **Open a UK business bank account** for that Ltd. Tide and Starling both do digital sole-director accounts in ~10 min.
3. Note down: company number, registered address, your director details.

### 3b. Sign up for Stripe as the platform

1. https://dashboard.stripe.com/register — sign up with the new Ltd's details. **Business type = Company**.
2. Complete the onboarding (KYC). Bank details point at the platform Ltd's bank account.
3. Once your standard account is approved, go to **Connect** in the left sidebar → **Get started**.
4. Pick **Standard** as the integration type. *(Standard = each venue gets their own Stripe dashboard. Best fit for takeaways.)*
5. Fill in the platform profile Stripe asks for (the website URL — your future platform marketing site, OK to start with `https://ricosyork.co.uk` for now and update later).
6. Submit the platform application. **Approval is usually instant for Standard, can take up to 48h.**

### 3c. Onboard RICOS as the first connected account

1. In your platform dashboard: **Connect → Accounts → Create**.
2. Pick **Standard**, country **GB**.
3. Enter the email of whoever runs RICOS day-to-day.
4. Stripe sends them an onboarding link → they complete KYC for **RICOS CHICKEN LIMITED** (Companies House 16996733), bank details, etc.
5. When complete, the account is enabled. Note the **account ID** — it looks like `acct_1XXXXXXXXXXXXXX` and is shown at the top of that account's view in your platform dashboard.

> *Since you control both entities, you'll be doing both sides of this onboarding yourself.*

### 3d. Wire the connected account ID into the codebase

Open `data/config.json` and replace the `TBD` value:

```json
"stripe": {
  "connectedAccountId": "acct_1XXXXXXXXXXXXXX"
}
```

Commit and push. Cloudflare auto-redeploys.

### 3e. Get the platform API keys

In the platform dashboard:

1. **Developers → API keys** → copy:
   - **Publishable key** (`pk_test_...` → later `pk_live_...`)
   - **Secret key** (`sk_test_...` → later `sk_live_...`)
2. **Developers → Webhooks → Add endpoint** → choose **"Listen on Connected accounts"** *(this is the key step — without it, paid-order events never reach our webhook):*
   - URL: `https://ricosyork.co.uk/api/stripe-webhook` *(once your domain is set up; use the `*.pages.dev` URL until then)*
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the **Signing secret** (`whsec_...`).

### 3f. Set the secrets in Cloudflare

In the Pages project: **Settings → Variables and Secrets → Add → Type = Secret**:

| Name | Value |
|---|---|
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (the platform's, not the venue's) |
| `STRIPE_SECRET_KEY` | `sk_test_...` (platform) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from the Connect webhook) |

After saving, redeploy (push any commit, or use the **Create deployment** button).

Once Stripe approves the platform for **live mode**, repeat with the `pk_live_...`, `sk_live_...`, and a fresh webhook secret from a webhook endpoint you create in live mode.

## 4. Resend (email)

1. Sign up at https://resend.com (free tier covers 3,000 emails/month).
2. Verify your domain — add the DNS records Resend gives you to your DNS provider. Without this, emails will land in spam.
3. **API keys → Create API key** → copy the `re_...` value.
4. Set on Cloudflare:

```sh
npx wrangler pages secret put RESEND_API_KEY    --project-name=ricos
npx wrangler pages secret put RESEND_FROM_EMAIL --project-name=ricos   # e.g. orders@yourdomain.co.uk
```

## 5. Twilio (SMS — only if marketing list is wanted)

1. Sign up at https://twilio.com.
2. **Phone Numbers → Buy a number** (pick a UK alphanumeric sender or a real number — UK SMS shortcodes are pricier).
3. **Account → API keys & Tokens** → copy Account SID + Auth Token.
4. Set on Cloudflare:

```sh
npx wrangler pages secret put TWILIO_ACCOUNT_SID --project-name=ricos
npx wrangler pages secret put TWILIO_AUTH_TOKEN  --project-name=ricos
npx wrangler pages secret put TWILIO_FROM_NUMBER --project-name=ricos   # e.g. +447xxxxxxxxx
```

You can defer this until after launch — the order flow works without Twilio.

## 6. Staff PIN

Pick a 4–8 digit PIN. Compute its SHA-256 hash:

```sh
echo -n "1234" | shasum -a 256
# 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
```

Use the hex string (without trailing dash and filename) as the secret value:

```sh
npx wrangler pages secret put STAFF_PIN_HASH --project-name=ricos
# paste the hash when prompted
```

Generate a random session secret and set it too:

```sh
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
npx wrangler pages secret put SESSION_SECRET --project-name=ricos
```

## 7. Edit `data/config.json`

Update:

- `business.legalName`, `business.companyNumber`, `business.phone`, `business.email`, `business.domain`
- `hours.*` — your real opening hours per day
- `fulfillment.delivery.allowedOutcodes` — final list once you've narrowed York's ring road postcodes
- `fulfillment.delivery.feePence` (200 = £2 — already set)
- `promo.autoOnlineDiscount` — keep, change, or disable

Commit and push. Cloudflare redeploys automatically.

## 8. Domain

1. In the Cloudflare Pages project: **Custom domains → Set up a custom domain** → enter your domain (e.g. `ricosperiperi.co.uk`).
2. Cloudflare will tell you which DNS records to add.
   - If your domain's registered with Cloudflare, the records get added automatically.
   - Otherwise log in at your registrar (GoDaddy / 123-Reg / Namecheap) and add the records as instructed. Allow up to a few hours for propagation.
3. Once active, the site is live at `https://yourdomain.co.uk` and `https://www.yourdomain.co.uk`.

## 9. Update Stripe webhook URL

Now that the domain is live, go back to **Stripe → Developers → Webhooks**, edit the endpoint URL to `https://yourdomain.co.uk/api/stripe-webhook` (it was a `*.pages.dev` URL until now).

## 10. Switch Stripe to live

Once Stripe verification has passed:

1. Toggle Stripe to **Live mode** (top-right).
2. Repeat step 3.5 with the live `pk_live_...`, `sk_live_...`, and a fresh `whsec_...` from a webhook endpoint you create in live mode.
3. The first card payment is the moment of truth — place a small real order to confirm.

## 11. ICO registration

UK food businesses that handle customer data must register with the Information Commissioner's Office. Fee is ~£40/year for small businesses.
https://ico.org.uk/for-organisations/data-protection-fee/

## 12. Launch checklist

- [ ] Cloudflare Pages deployed, domain attached, HTTPS working
- [ ] All four KV namespaces bound
- [ ] All Stripe + Resend secrets set
- [ ] PIN hash + session secret set
- [ ] `data/config.json` reflects real hours and postcodes
- [ ] Real Stripe live key in place (not test)
- [ ] Stripe webhook URL points at the live domain
- [ ] Resend domain verified
- [ ] Tablet at the shop has `https://yourdomain.co.uk/staff` bookmarked, has logged in with the PIN, and "Add to Home Screen" is done so it runs full-screen
- [ ] Test order: place from your phone, confirm tablet chimes, accept, confirm "ready at" email arrives
- [ ] ICO registered

## Hardware (recommended)

- **Tablet:** Lenovo Tab M9 (~£120) or any iPad. Mount on a counter stand. Plug it in — never let it sleep.
- **Receipt printer (optional):** Star TSP143IIIBI Bluetooth thermal (~£220). Pair with the tablet, then hit the **Print** button on the staff dashboard for each order. (Native browser printing is wired up; we can add direct ESC/POS integration later if you want one-tap print.)

## Common issues

- **Card payment fails / spinner forever**: usually `STRIPE_WEBHOOK_SECRET` is wrong or the webhook URL hasn't been updated to the live domain.
- **No emails**: Resend domain not verified, or `RESEND_FROM_EMAIL` doesn't match the verified domain.
- **Staff dashboard says "Wrong PIN"**: `STAFF_PIN_HASH` is the *hash*, not the PIN itself. Re-run step 6.
- **Postcode says "we don't deliver" for a valid address**: check `fulfillment.delivery.allowedOutcodes` in `data/config.json`.
