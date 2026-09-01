# Villix Manager — Owner Setup and Launch Checklist

Last updated: September 1, 2026

This is the owner-facing checklist for configuring and operating Villix Manager. It covers only tasks that require access to Villix accounts, DNS, company documents, or financial providers. Application code and database migrations are maintained separately in the repository.

## Current operating model

- `admin.villix.in` is the private administrator workspace.
- `contributor.villix.in` is the restricted contributor and final-recipient portal.
- DataCurve/Shipd pays Villix. Villix then calculates and distributes eligible amounts.
- Only `problem` contributions are distributable: Villix retains 50% and the remaining 50% follows the contributor's payout route.
- `bonus` contributions are retained fully by Villix.
- If a contributor has a team lead, the contributor's entire payable amount routes to that team lead.
- Independent contributors are paid directly.
- Payouts are weekly, scheduled for Monday.
- Final payouts are INR to verified Indian bank accounts.
- The system stays in test mode until Villix's company and RazorpayX onboarding are complete.

## Status legend

- `[x]` Reported complete or already implemented.
- `[ ]` Requires an action from the Villix owner.
- `[Later]` Complete only when the named provider or company setup is available.

## 1. Immediate security actions

- [ ] **Rotate the Gmail/Google Workspace app password used for Supabase SMTP.** A previous app password appeared in a screenshot. Revoke it in the Google account, create a new app password, and update Supabase Authentication → Emails → SMTP Settings.
- [ ] **Rotate the Shipd API key.** A previous key appeared in a screenshot. Revoke it in Shipd, create a replacement with the narrowest available permissions, and replace `SHIPD_API_KEY` in Render.
- [ ] Confirm that no secret is stored in GitHub, documentation, screenshots, browser bookmarks, or any `NEXT_PUBLIC_*` variable.
- [ ] Enable MFA on GitHub, Render, Supabase, the DNS provider, Google Workspace, Shipd, and RazorpayX.
- [ ] Store recovery codes and provider ownership information in Villix's company password manager.

Never place these values in client-visible variables:

- `SUPABASE_SECRET_KEY`
- `SHIPD_API_KEY`
- `RAZORPAYX_KEY_SECRET`
- `RAZORPAYX_WEBHOOK_SECRET`
- `RAZORPAYX_WEBHOOK_PREVIOUS_SECRET`
- SMTP password

## 2. GitHub repository

- [x] Repository: `https://github.com/gohildev2004/villix_manager`
- [x] Render deploys from the `main` branch.
- [ ] Ensure the repository is private unless Villix intentionally chooses otherwise.
- [ ] Give repository administration access to at least one second trusted company owner.
- [ ] Enable branch protection for `main` before adding more developers:
  - require a pull request;
  - require passing build/tests;
  - prevent force-pushes and branch deletion;
  - require review for changes to payout, authentication, migrations, or provider code.
- [ ] Enable GitHub secret scanning and Dependabot alerts.

## 3. Render hosting

Use the existing `villix-manager` web service. Do not create another production web service for the contributor domain; both domains route to the same application with hostname isolation.

### Service configuration

- [x] Runtime: Node.js.
- [x] Build command: `npm ci && npm run build`.
- [x] Start command: `npm start`.
- [x] Health check: `/api/health`.
- [x] Automatic deploys from `main`.
- [ ] Confirm the service is on a paid plan before production so it does not sleep during authentication, receipt imports, webhooks, or payouts.
- [ ] Configure deployment notifications for failed builds and unhealthy services.

### Required Render environment variables

Verify every variable in Render → `villix-manager` → Environment. Secret values must be entered only in Render.

| Variable | Required now | Expected value or source |
| --- | --- | --- |
| `NODE_VERSION` | Yes | `22.22.1` or the pinned repository value |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Villix Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Yes | Supabase `sb_secret_...` server key |
| `EMAIL_OTP_ENABLED` | Yes | `true` after admin OTP is verified |
| `PAYEE_PORTAL_ORIGIN` | Yes | `https://contributor.villix.in` |
| `NEXT_PUBLIC_CONTRIBUTOR_PORTAL_URL` | Yes | `https://contributor.villix.in` |
| `SHIPD_API_KEY` | Only when sync is implemented | Rotated server-only Shipd key |
| `RAZORPAYX_KEY_ID` | Later | RazorpayX test/live key ID |
| `RAZORPAYX_KEY_SECRET` | Later | RazorpayX test/live secret |
| `RAZORPAYX_ACCOUNT_NUMBER` | Later | Villix RazorpayX source account number, not a beneficiary account |
| `RAZORPAYX_WEBHOOK_SECRET` | Later | Strong secret created during webhook setup |
| `RAZORPAYX_WEBHOOK_PREVIOUS_SECRET` | During rotation only | Previous webhook secret; remove after rotation is verified |
| `RAZORPAYX_PAYOUT_MODE` | Later | `NEFT` unless Villix intentionally changes it |
| `RAZORPAYX_VENDOR_PORTAL_ENABLED` | Later | `false` until hosted onboarding is configured and tested |
| `RAZORPAYX_VENDOR_PORTAL_URL` | Later | RazorpayX-approved Vendor Portal URL |
| `RAZORPAYX_DIRECT_BANK_FORM_ENABLED` | Always | `false` |
| `PAYOUTS_LIVE_ENABLED` | Always until launch | `false` |

After changing any environment variable, choose **Save and deploy** and verify `/api/health` on the deployed service.

## 4. Domains and DNS

### Administrator domain

- [x] `admin.villix.in` points to the existing Render service.
- [ ] Confirm Render shows the domain as verified and its TLS certificate as active.
- [ ] Confirm `https://admin.villix.in/login` loads without a browser certificate warning.

### Contributor domain

- [x] Owner reported adding `contributor.villix.in` to the existing Render service.
- [ ] Confirm the DNS provider has the exact CNAME record shown by Render.
- [ ] In Render → Service → Settings → Custom Domains, confirm `contributor.villix.in` is **Verified**.
- [ ] Confirm `https://contributor.villix.in` loads the **Villix Contributor** login.
- [ ] Confirm `https://contributor.villix.in/people` returns 404 and does not expose the admin workspace.
- [ ] Do not create or keep `pay.villix.in` unless Villix later needs it for a separate product.

Render custom-domain reference: <https://render.com/docs/custom-domains>

## 5. Supabase project

### Project ownership and database

- [x] Villix has a dedicated Supabase project in the Mumbai region.
- [x] Database schema, row-level security, private receipt storage, audit tables, payout tables, and portal-access tables have been created by migrations.
- [x] The initial owner is configured.
- [ ] Add a second trusted company owner to the Supabase organization.
- [ ] Enable MFA enforcement for the Supabase organization.
- [ ] Before production, select a Supabase plan with the required backup and availability guarantees.
- [ ] Enable database SSL enforcement and review network restrictions before production.
- [ ] Review Supabase Security and Performance Advisors after every migration.
- [ ] Never edit historical financial rows manually. Corrections must be recorded through the application or a reviewed forward-only migration.

### Authentication URL configuration

Open Supabase → Authentication → URL Configuration.

- [ ] Set **Site URL** to `https://admin.villix.in`.
- [ ] Keep these exact allowed redirect URLs:
  - `https://admin.villix.in/auth/confirm`
  - `https://contributor.villix.in/auth/confirm`
  - the Render `onrender.com` confirmation URL only if it is still used for testing;
  - localhost confirmation URLs only while actively developing locally.
- [ ] Remove obsolete `localhost`, `pay.villix.in`, and old preview redirects before production unless they are still required.
- [ ] Test both admin and contributor OTP flows after every redirect change.

Supabase redirect configuration reference: <https://supabase.com/docs/guides/auth/general-configuration>

### SMTP and OTP email

- [x] Custom SMTP was configured for Villix authentication email.
- [ ] Complete the SMTP password rotation described in the security section.
- [ ] Sender name: `Villix` or `Villix Security`.
- [ ] Sender email: a monitored Villix-owned address such as `admin@villix.in` or `no-reply@villix.in`.
- [ ] Ensure SPF, DKIM, and DMARC are configured for the sending domain.
- [ ] Disable link tracking in the SMTP provider for authentication messages.
- [ ] Ensure the Magic Link/OTP template uses `{{ .Token }}` and says **one-time code** rather than hard-coding “six-digit”; this project currently uses an eight-digit OTP.
- [ ] Test delivery to Gmail and at least one non-Gmail address, including spam-folder behavior.
- [ ] Keep the resend cooldown enabled and choose a reasonable OTP expiry.

Supabase recommends custom SMTP for production authentication rather than its default best-effort service: <https://supabase.com/docs/guides/auth/auth-smtp>

## 6. Shipd/DataCurve integration

- [x] Villix can create a Shipd API key.
- [ ] Rotate the exposed key and update Render.
- [ ] Confirm with Shipd/DataCurve which API product, base URL, endpoints, scopes, rate limits, and webhook options apply to the Villix team account.
- [ ] Ask whether the API can return:
  - Villix team members and handles;
  - contribution/submission rows;
  - contribution type (`problem`, `bonus`, and future types);
  - gross USD amount per row;
  - receipt or payout identifiers;
  - payment status and settlement details.
- [ ] Request official API documentation from Shipd support. Do not use `shipai.today` documentation; it refers to a different product.
- [ ] Until the integration is implemented and tested, continue importing the official PDF receipt. Merely storing `SHIPD_API_KEY` does not enable automatic sync.
- [ ] When sync is implemented, test it against a non-production dataset and retain PDF import as a reconciliation fallback.

## 7. Villix company and banking setup

- [ ] Complete Villix Private Limited incorporation in India.
- [ ] Obtain the company PAN, TAN, Certificate of Incorporation, registered-office proof, and other documents requested by the bank or RazorpayX.
- [ ] Open a company current account in Villix's legal name.
- [ ] Confirm the correct accounting treatment, contractor agreements, invoices, TDS obligations, GST implications, foreign inward remittance records, and payout documentation with Villix's CA/legal adviser.
- [ ] Keep DataCurve/Shipd contracts, Stripe settlement statements, bank credits, Villix Manager payout reports, and contractor invoices linked by period.

This application calculates and records payout instructions; it is not a substitute for tax, accounting, employment-classification, or legal advice.

## 8. RazorpayX account activation

Do not enable live payouts until the company, KYC, current account, and RazorpayX account are approved.

- [Later] Create the RazorpayX account using Villix Private Limited's legal information.
- [Later] Complete RazorpayX activation and KYC.
- [Later] Confirm that Payout APIs, Contacts, Fund Accounts, webhooks, test mode, and live mode are enabled for the account.
- [Later] Obtain test API keys first.
- [Later] Locate the Villix RazorpayX source account number used by the Payout API.
- [Later] Decide whether to use RazorpayX Vendor Portal for recipient onboarding and confirm the exact product behavior with RazorpayX support.

RazorpayX requires a Contact and Fund Account for a normal payout and requires account activation/KYC: <https://razorpay.com/docs/x/payouts/>

### Render outbound IP allowlisting

RazorpayX Live Mode requires payout API source IPs to be allowlisted.

- [Later] In Render, open `villix-manager` → Connect → Outbound and inspect the available outbound ranges.
- [Later] Ask RazorpayX whether it accepts those ranges. If it requires individual static addresses, purchase Render dedicated outbound IPs or use an approved fixed-egress solution.
- [Later] Add every actual payout-service outbound IP in RazorpayX → My Account & Settings → Developer Controls → Share IP Addresses.
- [Later] Repeat this separately for staging and production if they use different IPs.

References:

- RazorpayX IP allowlisting: <https://razorpay.com/docs/x/dashboard/allowlist-ip/>
- Render outbound addresses: <https://render.com/docs/outbound-ip-addresses>
- Render dedicated IPs: <https://render.com/docs/dedicated-ips>

### RazorpayX webhook

- [Later] Create the production webhook URL:

  `https://admin.villix.in/api/webhooks/razorpayx`

- [Later] Subscribe to the payout lifecycle events available for the account, including processed, failed, reversed, and rejected/cancelled states where supported.
- [Later] Generate a strong unique webhook secret and store it as `RAZORPAYX_WEBHOOK_SECRET` in Render.
- [Later] Send a test webhook and verify it appears once in Villix Manager's audit/reconciliation records.
- [Later] Verify duplicate webhook delivery is safely ignored.
- [Later] During rotation, temporarily set `RAZORPAYX_WEBHOOK_PREVIOUS_SECRET`, install the new secret, verify delivery, then remove the previous secret.

### Recipient onboarding

- [Later] Enable RazorpayX Vendor Portal for the Villix account.
- [Later] Review the business name, logo, phone, and email shown to recipients.
- [Later] Confirm with RazorpayX that the portal can collect the required bank information for Villix's contractor payout workflow.
- [Later] Set `RAZORPAYX_VENDOR_PORTAL_URL` to the approved hosted URL.
- [Later] Set `RAZORPAYX_VENDOR_PORTAL_ENABLED=true` only after the full hosted flow is tested.
- [Later] Keep `RAZORPAYX_DIRECT_BANK_FORM_ENABLED=false` so Villix Manager does not collect full bank-account details.
- [Later] Invite only final payout recipients:
  - team leads receiving team payouts;
  - independent contributors receiving direct payouts.
- [Later] Do not invite contributors whose money routes entirely to a team lead.

RazorpayX Vendor Portal references:

- Business setup: <https://razorpay.com/docs/x/vendor-payments/portal/business/>
- Recipient onboarding: <https://razorpay.com/docs/x/vendor-payments/portal/>

## 9. Staging and payout testing

- [ ] Create a separate Render staging web service before connecting RazorpayX. Do not reuse production credentials or beneficiaries.
- [ ] Use a separate staging hostname and add its OTP callback to Supabase only while required.
- [ ] Use RazorpayX test credentials in staging.
- [ ] Keep production `PAYOUTS_LIVE_ENABLED=false`.
- [ ] In staging only, set `PAYOUTS_LIVE_ENABLED=true` after test credentials and IP configuration are complete.

Test this entire sequence:

1. Add a team lead and an independent contributor.
2. Add a contributor under the team lead.
3. Import a receipt containing `problem`, `bonus`, and an unknown type.
4. Confirm the unknown type and unmatched handle block approval.
5. Match the handle and resolve the unknown type intentionally.
6. Confirm bonus gross value remains visible but payable value is zero.
7. Confirm `problem` pays exactly 50% under the active rule version.
8. Confirm a team member's payable amount routes entirely to the team lead.
9. Confirm an independent contributor becomes their own final recipient.
10. Confirm the weekly period and following Monday payout date.
11. Approve the payout batch and verify its snapshot cannot change silently.
12. Dispatch a RazorpayX test payout.
13. Verify success through webhook, manual sync, reconciliation, audit log, and provider status.
14. Test a failed payout and a reversed payout.
15. Deliver the same webhook twice and confirm it is recorded only once.
16. Retry the same payout and confirm the same idempotency key prevents duplication.
17. Confirm a second payout with a new idempotency key cannot be created accidentally while the first is processing.
18. Export and reconcile the weekly distribution against the receipt and provider totals.

RazorpayX requires `X-Payout-Idempotency` for payout requests: <https://razorpay.com/docs/api/x/payout-idempotency/make-request/>

## 10. Controlled production launch

Complete this section only after staging passes.

- [Later] Replace all RazorpayX test credentials with live credentials in production.
- [Later] Recreate Contacts and Fund Accounts in live mode; do not assume test beneficiaries carry over.
- [Later] Confirm the production webhook secret and outbound IP allowlist.
- [Later] Onboard one trusted final recipient.
- [Later] Create one low-value controlled payout.
- [Later] Confirm all of the following match:
  - Villix Manager payout recipient and amount;
  - RazorpayX payout ID and status;
  - RazorpayX balance debit and fees;
  - recipient bank credit;
  - webhook event;
  - reconciliation status;
  - audit log;
  - accounting record.
- [Later] Obtain a second administrator's approval of the controlled test.
- [Later] Set `PAYOUTS_LIVE_ENABLED=true` in production and redeploy.
- [Later] Process the first real weekly batch with two-person review.
- [Later] Keep manual bank fallback documented for provider outages, but never mark a payout paid without evidence and reconciliation.

## 11. Weekly operating process

1. Confirm the Shipd/DataCurve receipt belongs to the correct week.
2. Import the PDF or run the approved API sync when available.
3. Review duplicate detection, source total, dates, row count, handles, types, and gross amounts.
4. Resolve every unmatched contributor and unknown type.
5. Open the receipt breakdown and compare it to the source document.
6. Verify the correct published rule version applies.
7. Review People and Teams for changes effective during the period.
8. Confirm every final recipient has active portal access and a ready payout route.
9. Review the payout preview, Villix retained amount, and final recipient totals.
10. Approve the weekly payout batch.
11. Have a second administrator review the frozen payout snapshot.
12. Dispatch payouts only when the provider readiness checks are green.
13. Monitor processing, failure, reversal, and webhook status.
14. Run manual sync for any stale payout.
15. Reconcile the batch with RazorpayX and the bank statement.
16. Export and archive the payout report, source receipt, provider report, and accounting support.

## 12. Monthly and quarterly controls

- [ ] Review active administrators, contributors, team leads, and suspended accounts.
- [ ] Remove portal access when a contractor relationship ends, without deleting financial history.
- [ ] Rotate API keys and webhook secrets on a documented schedule and immediately after suspected exposure.
- [ ] Review Render deploy history, Supabase logs/advisors, audit events, failed OTPs, payout failures, and reconciliation gaps.
- [ ] Test restore and business-continuity procedures.
- [ ] Ask the CA to reconcile Stripe/DataCurve receipts, INR bank settlements, Villix retained revenue, contractor payouts, provider fees, TDS, and taxes.
- [ ] Review whether financial policy or contribution types must change. Publish a new rule version; never overwrite a rule used by historical payouts.

## 13. Do not do these things

- Do not enable `PAYOUTS_LIVE_ENABLED` merely because credentials exist.
- Do not enter recipient bank account numbers in the admin application.
- Do not expose server keys in `NEXT_PUBLIC_*` variables.
- Do not paste secrets into chat, screenshots, issues, commits, or documentation.
- Do not delete approved payout history to correct a mistake.
- Do not modify a published historical rule.
- Do not pay an individual contributor when their approved payout route is through a team lead.
- Do not approve a receipt with unknown types, unmatched handles, or an unreconciled source total.
- Do not retry an uncertain payout with a new idempotency key until its original provider status is reconciled.
- Do not rely on the Shipd API until its correct official documentation and returned data have been verified.

## 14. Final go-live sign-off

All boxes below must be checked before normal live payouts begin.

- [ ] Villix Private Limited and its current account are active.
- [ ] Contractor agreements, tax, invoicing, and compliance processes are approved by Villix's advisers.
- [ ] GitHub, Render, Supabase, DNS, Google Workspace, Shipd, and RazorpayX have MFA and recovery ownership.
- [ ] Exposed Gmail and Shipd credentials have been rotated.
- [ ] Both production domains have valid HTTPS and correct routing.
- [ ] Supabase redirects, SMTP, OTP templates, RLS, private storage, and backups are verified.
- [ ] RazorpayX KYC, API credentials, source account, IP allowlist, webhook, and recipient onboarding are verified.
- [ ] Staging has passed success, failure, reversal, duplicate, retry, and reconciliation tests.
- [ ] A controlled low-value production payout has reconciled successfully.
- [ ] Two trusted administrators have approved the production switch.
- [ ] `PAYOUTS_LIVE_ENABLED=true` is enabled only after every preceding requirement is complete.

