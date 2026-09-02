do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'people', 'payee_profiles', 'payee_portal_accounts', 'receipts',
    'contribution_entries', 'audit_events', 'payout_batches', 'payout_recipients',
    'payment_attempts', 'workspace_settings', 'rule_versions', 'contribution_rules',
    'provider_webhook_events'
  ]
  loop
    if to_regclass(format('public.%I', relation_name)) is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = relation_name
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', relation_name);
    end if;
  end loop;
end
$$;
