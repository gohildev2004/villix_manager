revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index idx_audit_events_actor_id on public.audit_events(actor_id) where actor_id is not null;
create index idx_contribution_entries_type on public.contribution_entries(type);
create index idx_payment_attempts_attempted_by on public.payment_attempts(attempted_by) where attempted_by is not null;
create index idx_payout_batches_approved_by on public.payout_batches(approved_by) where approved_by is not null;
create index idx_payout_recipients_person_id on public.payout_recipients(person_id);
create index idx_receipts_approved_by on public.receipts(approved_by) where approved_by is not null;
create index idx_receipts_imported_by on public.receipts(imported_by) where imported_by is not null;
create index idx_team_assignments_changed_by on public.team_assignments(changed_by) where changed_by is not null;
create index idx_workspace_settings_updated_by on public.workspace_settings(updated_by) where updated_by is not null;

analyze public.audit_events;
analyze public.contribution_entries;
analyze public.payment_attempts;
analyze public.payout_batches;
analyze public.payout_recipients;
analyze public.receipts;
analyze public.team_assignments;
analyze public.workspace_settings;
