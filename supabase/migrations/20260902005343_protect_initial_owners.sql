alter table private.initial_owners enable row level security;

comment on table private.initial_owners is
  'Server-only staging owner allowlist. RLS intentionally has no client policies.';
