create unique index rule_versions_one_draft_idx
  on public.rule_versions (status)
  where status = 'draft';

create or replace function private.validate_rule_version_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'archived' then
    raise exception 'Archived rule versions are immutable.';
  end if;

  if old.status = 'published' then
    if new.status <> 'archived'
      or new.version is distinct from old.version
      or new.effective_from is distinct from old.effective_from
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.published_by is distinct from old.published_by
      or new.published_at is distinct from old.published_at then
      raise exception 'Published rule versions can only be archived without other changes.';
    end if;
    return new;
  end if;

  if old.status = 'draft' then
    if new.status <> 'published'
      or new.version is distinct from old.version
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Draft rule versions can only transition to published.';
    end if;
    if not exists (
      select 1 from public.contribution_rules
      where version = old.version and active = true
    ) then
      raise exception 'Add at least one active contribution rule before publishing.';
    end if;
  end if;

  return new;
end;
$$;

create trigger rule_versions_valid_transition
before update on public.rule_versions
for each row execute function private.validate_rule_version_transition();

create policy "villix_admin_create_draft_versions"
on public.rule_versions for insert to authenticated
with check (
  (select private.is_villix_admin())
  and status = 'draft'
  and created_by = (select auth.uid())
);

create policy "villix_admin_transition_rule_versions"
on public.rule_versions for update to authenticated
using (
  (select private.is_villix_admin())
  and status in ('draft', 'published')
)
with check (
  (select private.is_villix_admin())
  and status in ('published', 'archived')
);

grant insert, update on public.rule_versions to authenticated;

alter function public.create_rule_version() security invoker;
alter function public.publish_rule_version(integer, date) security invoker;
