alter table public.contribution_entries
  add column rule_version integer references public.rule_versions(version) on delete restrict;

update public.contribution_entries as entry
set rule_version = coalesce(types.version, 1)
from public.contribution_types as types
where types.type = entry.type;

update public.contribution_entries set rule_version = 1 where rule_version is null;

alter table public.contribution_entries
  alter column rule_version set not null,
  drop constraint contribution_entries_type_fkey,
  add constraint contribution_entries_type_format check (type ~ '^[a-z][a-z0-9_-]{1,39}$');

create index contribution_entries_rule_version_idx on public.contribution_entries(rule_version);

analyze public.contribution_entries;
