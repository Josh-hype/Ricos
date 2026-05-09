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

## 3. Stripe

1. Create the account at https://dashboard.stripe.com/register. Pick **business type = Company** and provide the limited company details + UK bank account.
2. While verification is pending, switch to **Test mode** (toggle top-right) so you can build and test.
3. **Developers → API keys** → copy:
   - **Publishable key** (starts `pk_test_...` then later `pk_live_...`)
   - **Secret key** (starts `sk_test_...` / `sk_live_...`)
4. **Developers → Webhooks → Add endpoint:**
   - URL: `https://YOUR-DOMAIN/api/stripe-webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the **Signing secret** (`whsec_...`).
5. Set the secrets on Cloudflare Pages:

```sh
npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY  --project-name=ricos
npx wrangler pages secret put STRIPE_SECRET_KEY       --project-name=ricos
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET   --project-name=ricos
```

Once Stripe verification passes (1–2 days), repeat with the live keys.

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
