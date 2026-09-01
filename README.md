# Villix Manager

Private operations software for Villix administrators. It manages contributors and team leads, imports contribution receipts, applies versioned commission rules, and produces auditable weekly payout batches.

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

Final payout recipients use the separate `/payee` portal. Administrators invite only team leads and independent contributors; contributors assigned to a team lead do not receive individual portal access. Login is passwordless and every page is server-filtered to the authenticated recipient’s permanent person ID. The portal never exposes the administrator workspace or direct Supabase table access.

`PAYOUTS_LIVE_ENABLED` defaults to `false`. In this test mode, administrators can import receipts, verify calculations, and approve test batches, but the dispatch API refuses to create bank transfers. Set it to `true` only after production RazorpayX onboarding, credential verification, IP allowlisting, and a controlled payout test.

### RazorpayX activation checklist

Keep `PAYOUTS_LIVE_ENABLED=false` throughout incorporation and provider onboarding. When the RazorpayX account is approved:

1. Add RazorpayX **test-mode** API credentials and the account number to Render.
2. Add `SUPABASE_SECRET_KEY` using a Supabase `sb_secret_...` server key. Never expose it as a `NEXT_PUBLIC_*` variable.
3. In RazorpayX, create a webhook pointing to `https://admin.villix.in/api/webhooks/razorpayx`. Subscribe to payout lifecycle events, create a strong webhook secret, and add it to Render as `RAZORPAYX_WEBHOOK_SECRET`.
4. Enable RazorpayX Vendor Portal for hosted recipient onboarding. Set `RAZORPAYX_VENDOR_PORTAL_URL` to the approved hosted portal URL and change `RAZORPAYX_VENDOR_PORTAL_ENABLED=true`. Keep `RAZORPAYX_DIRECT_BANK_FORM_ENABLED=false`; Villix administrators must not enter recipient account numbers.
5. Invite each final recipient from **People → Profile → Payee portal access**. Contributors under a team lead do not need their own portal or beneficiary because their payable share routes to the lead.
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

After deployment, add the Render origin, `https://admin.villix.in/auth/confirm`, and `https://admin.villix.in/payee/auth/confirm` to the Supabase Auth redirect allow list. Keep `PAYEE_PORTAL_ORIGIN` pinned to the canonical HTTPS origin so invitation links never depend on a request host header.

## Database

The SQL migrations in `supabase/migrations/` define the production schema, RLS policies, storage policy, indexes, and initial owner claim. Apply future schema changes as new migrations—never edit production financial rows manually.

For a brand-new Supabase project, insert the approved owner email into `private.initial_owners` from the SQL editor before that person signs in. The production Villix owner is already configured.

## Verification

```bash
npm run lint
npm test
```
