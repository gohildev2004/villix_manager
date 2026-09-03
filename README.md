# Villix Manager

Private operations software for Villix administrators. It manages contributors and team leads, imports contribution receipts, applies versioned commission rules, and produces auditable weekly payout batches.

Owner account setup, security, provider onboarding, testing, weekly operations, and go-live requirements are tracked in [OWNER_SETUP_AND_LAUNCH.md](./OWNER_SETUP_AND_LAUNCH.md).

The public `villix.in` contributor form is connected through the server-only contract in [CONTRIBUTOR_APPLICATION_INTEGRATION.md](./CONTRIBUTOR_APPLICATION_INTEGRATION.md). The API creates restricted portal access, sends the applicant a private invitation, and lets the applicant claim an intended or existing Shipd.ai username that remains editable until an approved receipt matches it.

## Reliability workflow

Every push and pull request to `main` runs GitHub Actions on Node 22. The workflow lints the repository, executes behavioral payout and receipt tests, builds the production application, and runs integration assertions. The behavioral suite verifies actual calculation outcomes, including bonus retention, the 50% problem split, direct and team-lead routing, historical assignments, unknown rules, unmatched contributors, and settlement adjustments.

Production uses `/api/health/ready` as its Render readiness probe. That route checks Supabase using a server-only client but returns only `ready` or `unavailable`. Authenticated administrators receive detailed checks through `/api/monitoring`, displayed under **Overview → System health**. It reports database and receipt-storage availability, missing server configuration, review receipts, stuck payout batches, failed or stale transfer attempts, and RazorpayX webhook health without exposing secrets publicly.

`render.staging.yaml` is the isolated staging blueprint. Create a separate Render Blueprint from that file and connect it to a separate Supabase project containing fake data only. Staging starts with `PAYOUTS_LIVE_ENABLED=false`; add only RazorpayX test credentials when they become available. Never point staging at the production Supabase URL or reuse live provider credentials.

## Financial policy

- `problem`: 50% retained by Villix, 50% payable
- `bonus`: 100% retained by Villix, 0% payable
- contributors assigned to a team lead route their entire payable share to that team lead
- independent contributors route their payable share directly
- unknown contribution types and unmatched handles block approval

All amounts are stored as integer cents. Receipt files live in a private Supabase Storage bucket, and database access is protected by row-level security.

## Stack

- Next.js 16 and React 19
- Supabase PostgreSQL, Auth, and Storage
- Render Web Service
- Node.js 22+

## Local setup

Copy `.env.example` to `.env.local`, add the Villix Supabase publishable key, then run:

```bash
npm ci
npm run dev
```

## Render deployment

Create a **Web Service** from this repository. Render can read `render.yaml`; set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` when prompted. The Supabase URL is already declared in the blueprint.

For contractor payouts, configure the server-only `SUPABASE_SECRET_KEY`, `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, and `RAZORPAYX_WEBHOOK_SECRET` values in Render. RazorpayX requires the Render outbound IP to be allowlisted and an idempotency key on every payout request. Keep these values out of all `NEXT_PUBLIC_*` variables. Villix supports verified Indian bank accounts only and records, approves, and sends every payout in INR.

Final payout recipients use the separate `https://contributor.villix.in` portal (`/payee` remains a local-development and compatibility path). Administrators enable access only for team leads and independent contributors; contributors assigned to a team lead do not receive individual portal access. Enabling access never sends an OTP. The recipient opens the contributor link from their invitation and requests their own passwordless code. Every page is server-filtered to the authenticated recipient’s permanent person ID. Hostname routing fails closed so the contributor domain cannot expose the administrator workspace or its API routes.

`PAYOUTS_LIVE_ENABLED` defaults to `false`. In this test mode, administrators can import receipts, verify calculations, and approve test batches, but the dispatch API refuses to create bank transfers. Set it to `true` only after production RazorpayX onboarding, credential verification, IP allowlisting, and a controlled payout test.

### RazorpayX activation checklist

Keep `PAYOUTS_LIVE_ENABLED=false` throughout incorporation and provider onboarding. When the RazorpayX account is approved:

1. Add RazorpayX **test-mode** API credentials and the account number to Render.
2. Add `SUPABASE_SECRET_KEY` using a Supabase `sb_secret_...` server key. Never expose it as a `NEXT_PUBLIC_*` variable.
3. In RazorpayX, create a webhook pointing to `https://admin.villix.in/api/webhooks/razorpayx`. Subscribe to payout lifecycle events, create a strong webhook secret, and add it to Render as `RAZORPAYX_WEBHOOK_SECRET`.
4. Enable RazorpayX Vendor Portal for hosted recipient onboarding. Set `RAZORPAYX_VENDOR_PORTAL_URL` to the approved hosted portal URL and change `RAZORPAYX_VENDOR_PORTAL_ENABLED=true`. Keep `RAZORPAYX_DIRECT_BANK_FORM_ENABLED=false`; Villix administrators must not enter recipient account numbers.
5. Use **Overview → Contributor onboarding** to enable and email final recipients in one BCC invitation, or use **People → Profile → Payee portal access** for one person. Recipients request their own OTP at `contributor.villix.in`. Contributors under a team lead do not need their own portal or beneficiary because their payable share routes to the lead.
6. Create a separate Render staging service with the same commit, allowlist its static outbound IP, use only RazorpayX test credentials, and set `PAYOUTS_LIVE_ENABLED=true` only on that staging service. Verify a complete test-mode batch including success, failure, reversal, duplicate-webhook, and manual-sync paths. Production stays locked.
7. Replace the test credentials with live credentials. RazorpayX test Contacts and Fund Accounts are isolated, so recreate beneficiaries in live mode.
8. Run one controlled low-value live payout and confirm the webhook, payment ledger, audit log, bank credit, and reconciliation all agree.
9. Only after those checks, change `PAYOUTS_LIVE_ENABLED=true` and redeploy.

During webhook-secret rotation, keep the old value temporarily in `RAZORPAYX_WEBHOOK_PREVIOUS_SECRET`, install the new current secret, test delivery, and then remove the previous secret.

Build and start commands:

```text
npm ci && npm run build
npm start
```

After deployment, add the Render origin, `https://admin.villix.in/auth/confirm`, and `https://contributor.villix.in/auth/confirm` to the Supabase Auth redirect allow list. Keep `PAYEE_PORTAL_ORIGIN` and `NEXT_PUBLIC_CONTRIBUTOR_PORTAL_URL` pinned to `https://contributor.villix.in` so invitation links and administrator previews never depend on a request host header.

## Database

The SQL migrations in `supabase/migrations/` define the production schema, RLS policies, storage policy, indexes, and initial owner claim. Apply future schema changes as new migrations—never edit production financial rows manually.

For a brand-new Supabase project, insert the approved owner email into `private.initial_owners` from the SQL editor before that person signs in. The production Villix owner is already configured.

## Verification

```bash
npm run lint
npm test
```
