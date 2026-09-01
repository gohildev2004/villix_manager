create table public.payee_portal_accounts (
  person_id uuid primary key references public.people(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  provider_portal_status text not null default 'not_invited' check (provider_portal_status in ('not_invited', 'invited', 'completed', 'attention')),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payee_portal_accounts_status_idx
  on public.payee_portal_accounts(status, provider_portal_status);

create trigger payee_portal_accounts_updated_at
  before update on public.payee_portal_accounts
  for each row execute function private.set_updated_at();

alter table public.payee_portal_accounts enable row level security;

create policy "villix_admin_all"
  on public.payee_portal_accounts
  for all
  to authenticated
  using ((select private.is_villix_admin()))
  with check ((select private.is_villix_admin()));

revoke all on public.payee_portal_accounts from anon, authenticated;
grant select, insert, update, delete on public.payee_portal_accounts to authenticated;

comment on table public.payee_portal_accounts is
  'Server-verified link between an invited final payout recipient and a Supabase Auth user. Payees never receive direct Data API access.';
comment on column public.payee_portal_accounts.provider_portal_status is
  'Tracks the RazorpayX-hosted vendor onboarding handoff without storing bank details in Villix.';

analyze public.payee_portal_accounts;
