# Villix Manager — Third-Party Services

Last reviewed: September 2, 2026

This document is the service inventory for Villix Manager. It records what each external provider does, which data it handles, how it is configured, and whether the integration is active today. It must never contain passwords, API keys, bank details, or webhook secrets.

## Service inventory

| Service | Purpose | Current status | Production use |
| --- | --- | --- | --- |
| Supabase | PostgreSQL database, administrator and contributor authentication, private receipt storage, and realtime updates | Active | Core application backend |
| Render | Hosts the Next.js application and manages runtime environment variables | Active | `admin.villix.in` and `contributor.villix.in` |
| GitHub | Source control, deployment source, and CI | Active | `gohildev2004/villix_manager` |
| Resend | Sends contributor onboarding invitations over HTTPS | Active | Primary invitation email provider |
| Google Workspace / Gmail | Operates `admin@villix.in` and sends Supabase authentication emails through custom SMTP | Active | Administrator and contributor OTP email |
| GoDaddy | DNS management for `villix.in` and its subdomains | Active | Domain routing and email authentication records |
| DataCurve / Shipd | Source of contribution records and the payer to Villix | Active upstream; PDF import is active, API sync is not | Official weekly receipt source |
| Stripe Express | DataCurve's payment channel to Villix and source of the settlement exchange rate | Active upstream; no Villix Stripe API integration | Funds settle into the Villix bank account |
| RazorpayX | Recipient onboarding, bank verification, INR payout execution, and payout webhooks | Prepared but not live | Enable after the Villix company and RazorpayX account are approved |

## How the services connect

1. Contributors work through DataCurve / Shipd.
2. DataCurve produces the official contribution receipt and pays Villix through Stripe Express.
3. An administrator imports the receipt PDF into Villix Manager.
4. Villix Manager stores the source PDF privately in Supabase Storage and stores its structured records in Supabase Postgres.
5. Villix Manager applies the versioned contribution rules, team routing, holds, and the Stripe settlement rate to create the weekly INR distribution.
6. Resend sends contributor onboarding invitations. Supabase Auth sends one-time sign-in codes.
7. After RazorpayX is approved and live mode is intentionally enabled, Villix Manager will create INR payouts and reconcile their status through RazorpayX webhooks.

## 1. Supabase

### What it provides

- PostgreSQL database for people, teams, receipts, contribution entries, rules, payout batches, recipient holds, transfer attempts, and audit records.
- Passwordless authentication for administrators and contributor portal users.
- Private object storage for uploaded receipt PDFs.
- Realtime database events so multiple signed-in administrators see updates without refreshing.

### Environment separation

- Production and staging use different Supabase projects.
- Production must contain real operational data only after Villix is ready to operate.
- Staging must contain test users, test receipts, and simulated payout data only.
- Schema migrations must be applied to both projects before deploying application code that depends on them.

### Configuration names

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

The publishable key may be used by the browser with Row Level Security. `SUPABASE_SECRET_KEY` is server-only and must never use the `NEXT_PUBLIC_` prefix.

### Operational notes

- Keep Row Level Security enabled and policies scoped to the administrator or contributor access model.
- Keep receipt storage private.
- Configure the correct Site URL, redirect allowlist, email template, and custom SMTP settings independently in production and staging.
- A Supabase outage affects authentication, data access, receipt storage, and live updates.

## 2. Render

### What it provides

- Hosts the single Next.js web service that serves both the administrator and contributor experiences.
- Builds from GitHub and deploys commits from the configured branch.
- Stores server-side secrets and environment-specific configuration.
- Checks application readiness at `/api/health/ready`.

### Deployments

- Production service: `villix-manager`
- Production administrator domain: `https://admin.villix.in`
- Production contributor domain: `https://contributor.villix.in`
- Staging service: `villix-manager-staging`
- Staging origin: `https://villix-manager-staging.onrender.com`
- Production blueprint: `render.yaml`
- Staging blueprint: `render.staging.yaml`

### Operational notes

- Production and staging must use different Supabase credentials and appropriate provider keys.
- `VILLIX_ENVIRONMENT` identifies the environment.
- `PAYOUTS_LIVE_ENABLED` must remain `false` until production RazorpayX credentials, recipient onboarding, webhooks, and end-to-end tests are complete.
- A failed Render deployment or unhealthy service makes both portals unavailable.

## 3. GitHub

### What it provides

- Canonical source repository: `https://github.com/gohildev2004/villix_manager`
- Deployment source for Render.
- Continuous integration through `.github/workflows/ci.yml`.
- Reviewable history for application and database migration changes.

### Operational notes

- Never commit `.env` files, API keys, app passwords, service-role keys, bank data, or webhook secrets.
- Require successful tests before production deployment.
- Tag or otherwise record each production release so a deployed version can be traced back to a commit.

## 4. Resend

### What it provides

- Sends each selected contributor or team lead a separate private onboarding invitation.
- Uses an HTTPS API, which is suitable for Render even when outbound SMTP ports are restricted.
- Sends from a verified `villix.in` identity.

### Configuration names

- `RESEND_API_KEY`
- `INVITATION_FROM_EMAIL`
- `INVITATION_FROM_NAME`

### Operational notes

- Resend is the primary provider for contributor invitations when `RESEND_API_KEY` and the sender address are configured.
- Delivery status should be checked in Resend Logs. API acceptance does not guarantee inbox placement.
- Messages sent by Resend do not appear in the Gmail Sent folder because Gmail did not transmit them.
- Keep SPF, DKIM, and DMARC valid for the sending domain and monitor bounces or suppressions.

## 5. Google Workspace / Gmail

### What it provides

- Business mailbox `admin@villix.in`.
- Custom SMTP delivery for Supabase administrator and contributor OTP emails.
- Optional fallback transport for application invitations if Resend is unavailable and SMTP is supported by the host.

### Application fallback configuration names

- `INVITATION_SMTP_HOST`
- `INVITATION_SMTP_PORT`
- `INVITATION_SMTP_USER`
- `INVITATION_SMTP_PASSWORD`
- `INVITATION_FROM_EMAIL`
- `INVITATION_FROM_NAME`

### Operational notes

- Use a dedicated Google app password, not the mailbox password.
- Render services may block or time out on SMTP; Resend remains the preferred application invitation transport.
- Supabase custom SMTP is configured inside each Supabase project and is separate from Render's invitation settings.
- Rotate an exposed app password immediately.

## 6. GoDaddy

### What it provides

- DNS hosting for `villix.in`.
- CNAME routing for `admin.villix.in` and `contributor.villix.in` to Render.
- MX and TXT records used by Google Workspace and Resend.

### Records that must be maintained

- Render domain verification and routing records.
- Google Workspace MX records.
- A single valid SPF record that covers every authorized sender.
- Google Workspace DKIM.
- Resend DKIM and any provider-specific verification records.
- DMARC, initially monitored and later tightened after delivery is verified.

### Operational notes

- Do not create multiple SPF TXT records at the root; combine authorized senders into one record.
- DNS changes can take time to propagate.
- Cloudflare is not authorized for this project and must not be used.

## 7. DataCurve / Shipd

### What it provides

- The upstream workspace in which Villix contributors perform work.
- The official receipt containing contributor handles, contribution types, amounts, and totals.
- The payer relationship that funds Villix.

### Current integration status

- PDF receipt import is the active source-ingestion method.
- Automatic API synchronization is not implemented.
- A stored `SHIPD_API_KEY` alone does not enable synchronization.

### Future configuration name

- `SHIPD_API_KEY`

### Operational notes

- Use the narrowest API permissions available if synchronization is implemented.
- Rotate any key shown in a screenshot or shared outside the approved secret store.
- Preserve the receipt as the auditable source record even after API sync is introduced.

## 8. Stripe Express

### What it provides

- DataCurve's connected-account payment channel to Villix.
- Conversion and settlement of DataCurve's USD payment into the Villix INR bank account.
- The exact settlement exchange rate used for the weekly payout calculation.

### Current integration status

- Villix Manager does not call the Stripe API and stores no Stripe secret key.
- An administrator copies the exact settled INR-per-USD rate from Stripe into the weekly payout batch before approval.
- Villix Manager must use the actual settlement rate, not an assumed foreign-exchange fee.

### Operational notes

- Stripe is an upstream settlement dependency, not the provider used to pay Villix recipients.
- Retain settlement evidence so the INR calculation remains reproducible.

## 9. RazorpayX

### Intended use

- Hosted recipient/vendor onboarding and bank verification.
- Creation of INR payouts to direct contributors and team leads with Indian bank accounts.
- One administrator action may submit all eligible recipients in a batch, while Villix records and tracks a separate transfer for each recipient.
- Recipient-level holds and retries prevent one unavailable recipient from blocking the other payments.
- Webhook and manual synchronization update transfer status in Villix Manager.

### Configuration names

- `RAZORPAYX_KEY_ID`
- `RAZORPAYX_KEY_SECRET`
- `RAZORPAYX_ACCOUNT_NUMBER`
- `RAZORPAYX_WEBHOOK_SECRET`
- `RAZORPAYX_WEBHOOK_PREVIOUS_SECRET`
- `RAZORPAYX_PAYOUT_MODE`
- `RAZORPAYX_VENDOR_PORTAL_ENABLED`
- `RAZORPAYX_VENDOR_PORTAL_URL`
- `RAZORPAYX_DIRECT_BANK_FORM_ENABLED`
- `PAYOUTS_LIVE_ENABLED`

### Safety rules

- Use test credentials in staging and live credentials only in production.
- Keep `PAYOUTS_LIVE_ENABLED=false` until an explicit production launch decision.
- Keep `RAZORPAYX_DIRECT_BANK_FORM_ENABLED=false`; Villix administrators should not type or store a recipient's full bank-account details.
- Allowlist Render's required outbound IP address when RazorpayX requires it.
- Use a unique idempotency key for every payout instruction.
- Verify webhook signatures before processing events.
- During webhook-secret rotation, retain the previous secret only long enough to verify the new one, then remove it.
- A payout is not complete merely because the API accepted it; wait for the final provider status.

## Secret ownership and storage

| Secret type | Store in | Never store in |
| --- | --- | --- |
| Supabase server secret | Render environment for the matching environment | Browser code, GitHub, screenshots, or `NEXT_PUBLIC_*` variables |
| Resend API key | Render environment | GitHub, email templates, or browser code |
| Google app password | Supabase SMTP settings and, only if fallback is needed, Render | Source code, normal mailbox password fields, or screenshots |
| Shipd API key | Render only after API sync exists | Source code or client-side variables |
| RazorpayX credentials and webhook secrets | Render environment | GitHub, contributor portal, logs, or screenshots |

Production and staging should use separate credentials whenever the provider supports separate environments. Access should be limited to the Villix owners who operate that service, and every exposed credential must be revoked and replaced.

## Deliberately not used

- **Cloudflare:** not authorized for Villix Manager and belongs to a different account.
- **Firebase:** not part of the current architecture; Supabase is the backend.
- **Vercel:** not part of the current deployment; Render hosts the application.
- **A separate Render backend:** not required; the Next.js service contains the server routes.
- **Direct Stripe API integration:** not implemented; Stripe is currently only the upstream DataCurve settlement channel.

## Review checklist

Review this file whenever a provider is added, removed, or changes responsibility.

- Confirm each production service is owned by Villix and protected with multi-factor authentication.
- Confirm staging and production credentials are not mixed.
- Confirm no secrets have been committed or exposed in screenshots.
- Confirm provider domains, webhook endpoints, redirect URLs, and sender identities still match the deployed environment.
- Confirm live payouts remain disabled until RazorpayX onboarding and end-to-end test-mode validation are complete.
- Record the review date at the top of this file.
