create index payee_portal_accounts_created_by_idx
  on public.payee_portal_accounts(created_by);

analyze public.payee_portal_accounts;
