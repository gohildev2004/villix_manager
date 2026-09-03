alter table public.people
  add column shipd_handle_status text not null default 'claimed'
    check (shipd_handle_status in ('claimed', 'matched', 'conflict')),
  add column shipd_handle_matched_at timestamptz;

-- Preserve the lock guarantee for receipts that were approved before this migration.
update public.people as person
set shipd_handle_status = 'matched',
    shipd_handle_matched_at = coalesce(person.shipd_handle_matched_at, now())
where exists (
  select 1
  from public.contribution_entries as entry
  join public.receipts as receipt on receipt.id = entry.receipt_id
  where entry.contributor_id = person.id
    and receipt.status = 'approved'
    and lower(entry.source_handle::text) = lower(person.handle::text)
);

create table public.contributor_applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(trim(first_name)) between 1 and 60),
  last_name text not null check (char_length(trim(last_name)) between 1 and 60),
  email extensions.citext not null unique,
  team_lead_id uuid not null references public.people(id) on delete restrict,
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  person_id uuid unique references public.people(id) on delete restrict,
  shipd_handle extensions.citext,
  shipd_handle_status text not null default 'missing'
    check (shipd_handle_status in ('missing', 'claimed', 'matched', 'conflict')),
  status text not null default 'submitted'
    check (status in ('submitted', 'invited', 'profile_complete', 'declined')),
  invitation_status text not null default 'pending'
    check (invitation_status in ('pending', 'sent', 'failed')),
  invitation_sent_at timestamptz,
  last_error text,
  source text not null default 'villix_landing_page',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'profile_complete' and person_id is not null and shipd_handle is not null) or status <> 'profile_complete')
);

create index contributor_applications_status_created_idx
  on public.contributor_applications(status, created_at desc);
create index contributor_applications_team_lead_idx
  on public.contributor_applications(team_lead_id, status);
create index contributor_applications_shipd_handle_idx
  on public.contributor_applications(shipd_handle) where shipd_handle is not null;

create trigger contributor_applications_updated_at
  before update on public.contributor_applications
  for each row execute function private.set_updated_at();

alter table public.contributor_applications enable row level security;

create policy "villix_admin_all"
  on public.contributor_applications
  for all
  to authenticated
  using ((select private.is_villix_admin()))
  with check ((select private.is_villix_admin()));

revoke all on public.contributor_applications from anon, authenticated;
grant select, insert, update, delete on public.contributor_applications to authenticated;
grant all on public.contributor_applications to service_role;

create or replace function public.complete_contributor_application(
  target_application_id uuid,
  target_auth_user_id uuid,
  target_handle text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_row public.contributor_applications%rowtype;
  created_person_id uuid;
begin
  select * into application_row
  from public.contributor_applications
  where id = target_application_id and auth_user_id = target_auth_user_id
  for update;

  if not found then raise exception 'Contributor application was not found.'; end if;
  if application_row.status = 'declined' then raise exception 'This contributor application was declined.'; end if;
  if target_handle !~ '^@[A-Za-z0-9_.-]{2,64}$' then raise exception 'Enter a valid Shipd.ai username.'; end if;

  if application_row.person_id is not null then
    update public.people
      set handle = target_handle,
          shipd_handle_status = 'claimed',
          shipd_handle_matched_at = null
      where id = application_row.person_id and shipd_handle_status <> 'matched'
      returning id into created_person_id;
    if created_person_id is null then raise exception 'A receipt already matched this Shipd.ai username. Ask an administrator to change it.'; end if;
  else
    perform 1 from public.people
      where id = application_row.team_lead_id and role = 'team_lead' and status = 'active';
    if not found then raise exception 'The selected team leader is no longer available.'; end if;

    insert into public.people (display_name, handle, email, role, team_lead_id, payout_method, currency, shipd_handle_status)
    values (
      trim(application_row.first_name || ' ' || application_row.last_name),
      target_handle,
      application_row.email,
      'contributor',
      application_row.team_lead_id,
      'contractor',
      'INR',
      'claimed'
    ) returning id into created_person_id;

    insert into public.payee_profiles (person_id, legal_name, country, currency, payout_provider)
    values (created_person_id, trim(application_row.first_name || ' ' || application_row.last_name), 'IN', 'INR', 'razorpayx');

    insert into public.payee_portal_accounts (person_id, user_id, status, activated_at, last_seen_at, created_by)
    values (created_person_id, target_auth_user_id, 'active', now(), now(), target_auth_user_id);

    insert into public.team_assignments (contributor_id, team_lead_id, effective_from, changed_by)
    values (created_person_id, application_row.team_lead_id, current_date, target_auth_user_id);
  end if;

  update public.contributor_applications
    set person_id = created_person_id,
        shipd_handle = target_handle,
        shipd_handle_status = 'claimed',
        status = 'profile_complete',
        last_error = null
    where id = target_application_id;

  return created_person_id;
exception
  when unique_violation then
    raise exception 'That email or Shipd.ai username is already connected to another Villix profile.';
end;
$$;

revoke all on function public.complete_contributor_application(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_contributor_application(uuid, uuid, text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contributor_applications'
  ) then
    alter publication supabase_realtime add table public.contributor_applications;
  end if;
end $$;

comment on table public.contributor_applications is
  'Server-created applications from the Villix landing page. Applicants receive Auth access before a People record exists.';
comment on column public.people.shipd_handle_status is
  'A claimed handle stays editable until an approved receipt matches it exactly.';

analyze public.contributor_applications;
