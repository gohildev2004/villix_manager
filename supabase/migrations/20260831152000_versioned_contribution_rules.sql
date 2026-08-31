create table public.rule_versions (
  version integer primary key check (version > 0),
  status text not null check (status in ('draft', 'published', 'archived')),
  effective_from date,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  check (
    (status = 'draft' and published_by is null and published_at is null)
    or (status in ('published', 'archived') and effective_from is not null and published_at is not null)
  )
);

create unique index rule_versions_one_published_idx
  on public.rule_versions (status)
  where status = 'published';
create index rule_versions_created_by_idx on public.rule_versions (created_by) where created_by is not null;
create index rule_versions_published_by_idx on public.rule_versions (published_by) where published_by is not null;

create table public.contribution_rules (
  version integer not null references public.rule_versions(version) on delete cascade,
  type text not null check (type ~ '^[a-z][a-z0-9_-]{1,39}$'),
  label text not null check (char_length(trim(label)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 180),
  payout_bps integer not null check (payout_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (version, type)
);

insert into public.rule_versions (version, status, effective_from, published_at)
values (1, 'published', date '2026-08-24', now());

insert into public.contribution_rules (version, type, label, description, payout_bps, active)
values
  (1, 'problem', 'Problem', 'Eligible for weekly distribution', 5000, true),
  (1, 'bonus', 'Bonus', 'Retained by Villix in full', 0, true);

create or replace function private.ensure_rule_is_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.rule_versions
    where version = coalesce(new.version, old.version) and status = 'draft'
  ) then
    raise exception 'Published rule versions are immutable. Create a new draft version first.';
  end if;
  if tg_op <> 'DELETE' then
    new.updated_at = now();
    return new;
  end if;
  return old;
end;
$$;

create trigger contribution_rules_draft_only
before insert or update or delete on public.contribution_rules
for each row execute function private.ensure_rule_is_draft();

create or replace function public.create_rule_version()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_version integer;
  next_version integer;
begin
  if not (select private.is_villix_admin()) then
    raise exception 'Administrator access required';
  end if;

  lock table public.rule_versions in exclusive mode;
  if exists (select 1 from public.rule_versions where status = 'draft') then
    raise exception 'A draft rule version already exists';
  end if;

  select version into source_version
  from public.rule_versions
  where status = 'published';
  if source_version is null then
    raise exception 'No published rule version is available to copy';
  end if;

  select coalesce(max(version), 0) + 1 into next_version from public.rule_versions;
  insert into public.rule_versions (version, status, created_by)
  values (next_version, 'draft', (select auth.uid()));

  insert into public.contribution_rules (version, type, label, description, payout_bps, active)
  select next_version, type, label, description, payout_bps, active
  from public.contribution_rules
  where version = source_version;

  return next_version;
end;
$$;

create or replace function public.publish_rule_version(target_version integer, effective_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_villix_admin()) then
    raise exception 'Administrator access required';
  end if;
  if effective_date is null then
    raise exception 'An effective date is required';
  end if;

  lock table public.rule_versions in exclusive mode;
  if not exists (select 1 from public.rule_versions where version = target_version and status = 'draft') then
    raise exception 'Only a draft rule version can be published';
  end if;
  if not exists (select 1 from public.contribution_rules where version = target_version and active = true) then
    raise exception 'Add at least one active contribution rule before publishing';
  end if;

  update public.rule_versions
  set status = 'archived'
  where status = 'published';

  update public.rule_versions
  set status = 'published',
      effective_from = effective_date,
      published_by = (select auth.uid()),
      published_at = now()
  where version = target_version;

  update public.contribution_types set active = false, updated_at = now();
  insert into public.contribution_types (type, payout_bps, active, version, updated_at)
  select type, payout_bps, active, target_version, now()
  from public.contribution_rules
  where version = target_version
  on conflict (type) do update
  set payout_bps = excluded.payout_bps,
      active = excluded.active,
      version = excluded.version,
      updated_at = excluded.updated_at;

  return target_version;
end;
$$;

revoke all on function public.create_rule_version() from public, anon;
revoke all on function public.publish_rule_version(integer, date) from public, anon;
grant execute on function public.create_rule_version() to authenticated;
grant execute on function public.publish_rule_version(integer, date) to authenticated;

alter table public.rule_versions enable row level security;
alter table public.contribution_rules enable row level security;

create policy "villix_admin_read_rule_versions"
on public.rule_versions for select to authenticated
using ((select private.is_villix_admin()));

create policy "villix_admin_read_contribution_rules"
on public.contribution_rules for select to authenticated
using ((select private.is_villix_admin()));

create policy "villix_admin_add_draft_rules"
on public.contribution_rules for insert to authenticated
with check (
  (select private.is_villix_admin())
  and exists (select 1 from public.rule_versions where version = contribution_rules.version and status = 'draft')
);

create policy "villix_admin_update_draft_rules"
on public.contribution_rules for update to authenticated
using (
  (select private.is_villix_admin())
  and exists (select 1 from public.rule_versions where version = contribution_rules.version and status = 'draft')
)
with check (
  (select private.is_villix_admin())
  and exists (select 1 from public.rule_versions where version = contribution_rules.version and status = 'draft')
);

create policy "villix_admin_remove_draft_rules"
on public.contribution_rules for delete to authenticated
using (
  (select private.is_villix_admin())
  and exists (select 1 from public.rule_versions where version = contribution_rules.version and status = 'draft')
);

grant select on public.rule_versions to authenticated;
grant select, insert, update, delete on public.contribution_rules to authenticated;

alter table public.payout_batches
  add constraint payout_batches_rule_version_fkey
  foreign key (rule_version) references public.rule_versions(version) on delete restrict;

analyze public.rule_versions;
analyze public.contribution_rules;
