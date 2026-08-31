create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  display_name text not null,
  role text not null default 'admin' check (role in ('owner', 'admin', 'reviewer')),
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function private.is_villix_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and active = true
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_villix_admin() to authenticated;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 2 and 120),
  handle extensions.citext not null unique check (handle ~ '^@[A-Za-z0-9_.-]{2,64}$'),
  email extensions.citext not null unique,
  role text not null check (role in ('contributor', 'team_lead', 'admin')),
  team_lead_id uuid references public.people(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused')),
  country char(2) not null default 'IN',
  currency char(3) not null default 'INR',
  payout_method text not null default 'contractor' check (payout_method in ('contractor', 'direct', 'team', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_lead_id is null or team_lead_id <> id),
  check ((role = 'contributor') or team_lead_id is null)
);

create index idx_people_team_lead_id on public.people(team_lead_id) where team_lead_id is not null;
create index idx_people_role_status on public.people(role, status);

create table public.payee_profiles (
  person_id uuid primary key references public.people(id) on delete cascade,
  legal_name text not null default '',
  entity_type text not null default 'individual' check (entity_type in ('individual', 'business')),
  country char(2) not null default 'IN',
  currency char(3) not null default 'INR',
  contract_status text not null default 'missing' check (contract_status in ('missing', 'pending', 'verified')),
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started', 'pending', 'ready', 'restricted')),
  payout_provider text,
  provider_recipient_id text,
  bank_last4 text check (bank_last4 is null or bank_last4 ~ '^[0-9]{4}$'),
  ifsc text,
  pan_last4 text,
  updated_at timestamptz not null default now()
);

create table public.contribution_types (
  type text primary key,
  payout_bps integer not null check (payout_bps between 0 and 10000),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

insert into public.contribution_types (type, payout_bps) values ('problem', 5000), ('bonus', 0);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  storage_path text not null unique,
  receipt_date date not null,
  source_total_cents bigint not null check (source_total_cents >= 0),
  extracted_total_cents bigint not null check (extracted_total_cents >= 0),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'review' check (status in ('review', 'verified', 'approved', 'rejected')),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  imported_by uuid references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_total_cents = extracted_total_cents or status in ('review', 'rejected')),
  check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);

create index idx_receipts_date_status on public.receipts(receipt_date, status);

create table public.contribution_entries (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete restrict,
  contributor_id uuid references public.people(id) on delete restrict,
  source_name text not null,
  source_handle extensions.citext not null,
  type text not null references public.contribution_types(type) on update restrict,
  gross_cents bigint not null check (gross_cents >= 0),
  payout_bps integer check (payout_bps between 0 and 10000),
  payout_cents bigint check (payout_cents >= 0),
  routing_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index idx_entries_receipt_id on public.contribution_entries(receipt_id);
create index idx_entries_contributor_id on public.contribution_entries(contributor_id) where contributor_id is not null;

create table public.team_assignments (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.people(id) on delete restrict,
  team_lead_id uuid references public.people(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  changed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (team_lead_id is null or team_lead_id <> contributor_id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index idx_team_assignments_current on public.team_assignments(contributor_id) where effective_to is null;
create index idx_team_assignments_contributor_period on public.team_assignments(contributor_id, effective_from, effective_to);
create index idx_team_assignments_lead on public.team_assignments(team_lead_id) where team_lead_id is not null;

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  payout_date date,
  source_currency char(3) not null default 'USD',
  settlement_currency char(3) not null default 'INR',
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved', 'processing', 'paid', 'cancelled')),
  total_gross_cents bigint not null default 0 check (total_gross_cents >= 0),
  total_retained_cents bigint not null default 0 check (total_retained_cents >= 0),
  total_payable_cents bigint not null default 0 check (total_payable_cents >= 0),
  rule_version integer not null default 1,
  calculation_hash text,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_end >= period_start),
  check (total_gross_cents = total_retained_cents + total_payable_cents)
);

create index idx_payout_batches_status on public.payout_batches(status);

create table public.payout_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  routing_type text not null check (routing_type in ('direct', 'team')),
  contributor_count integer not null default 1 check (contributor_count > 0),
  gross_cents bigint not null check (gross_cents >= 0),
  retained_cents bigint not null check (retained_cents >= 0),
  payable_cents bigint not null check (payable_cents >= 0),
  contributor_breakdown jsonb not null default '[]'::jsonb,
  status text not null default 'ready' check (status in ('ready', 'processing', 'paid', 'failed', 'cancelled')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, person_id),
  check (gross_cents = retained_cents + payable_cents)
);

create index idx_payout_recipients_status on public.payout_recipients(status);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payout_recipient_id uuid not null references public.payout_recipients(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key text not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null check (status in ('processing', 'paid', 'failed')),
  provider text,
  provider_reference text,
  failure_reason text,
  attempted_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (payout_recipient_id, attempt_number)
);

create index idx_payment_attempts_recipient on public.payment_attempts(payout_recipient_id);

create table public.inbound_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_reference text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  received_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'settled', 'reversed')),
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create table public.workspace_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into public.workspace_settings (key, value) values
  ('payout_policy', '{"weekStarts":"Monday","timezone":"Asia/Kolkata","sourceCurrency":"USD","settlementCurrency":"INR","twoPersonApproval":true}'::jsonb);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_entity on public.audit_events(entity_type, entity_id);
create index idx_audit_created_at on public.audit_events(created_at desc);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger people_updated_at before update on public.people for each row execute function private.set_updated_at();
create trigger payee_profiles_updated_at before update on public.payee_profiles for each row execute function private.set_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'admin_users','people','payee_profiles','contribution_types','receipts','contribution_entries',
    'team_assignments','payout_batches','payout_recipients','payment_attempts','inbound_payments','workspace_settings','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'admin_users','people','payee_profiles','contribution_types','receipts','contribution_entries',
    'team_assignments','payout_batches','payout_recipients','payment_attempts','inbound_payments','workspace_settings'
  ] loop
    execute format('create policy "villix_admin_all" on public.%I for all to authenticated using ((select private.is_villix_admin())) with check ((select private.is_villix_admin()))', table_name);
  end loop;
end $$;

create policy "villix_admin_read_audit" on public.audit_events for select to authenticated using ((select private.is_villix_admin()));
create policy "villix_admin_append_audit" on public.audit_events for insert to authenticated with check ((select private.is_villix_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-files', 'receipt-files', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "villix_admin_read_receipts" on storage.objects for select to authenticated
using (bucket_id = 'receipt-files' and (select private.is_villix_admin()));
create policy "villix_admin_upload_receipts" on storage.objects for insert to authenticated
with check (bucket_id = 'receipt-files' and (select private.is_villix_admin()));
create policy "villix_admin_update_receipts" on storage.objects for update to authenticated
using (bucket_id = 'receipt-files' and (select private.is_villix_admin()))
with check (bucket_id = 'receipt-files' and (select private.is_villix_admin()));

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.audit_events from authenticated;

analyze public.people;
analyze public.receipts;
analyze public.contribution_entries;
analyze public.team_assignments;
analyze public.payout_batches;
analyze public.payout_recipients;
