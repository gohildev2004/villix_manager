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

Build and start commands:

```text
npm ci && npm run build
npm start
```

After deployment, add the Render origin and `https://<your-render-host>/auth/confirm` to the Supabase Auth URL configuration.

## Database

The SQL migrations in `supabase/migrations/` define the production schema, RLS policies, storage policy, indexes, and initial owner claim. Apply future schema changes as new migrations—never edit production financial rows manually.

For a brand-new Supabase project, insert the approved owner email into `private.initial_owners` from the SQL editor before that person signs in. The production Villix owner is already configured.

## Verification

```bash
npm run lint
npm test
```
