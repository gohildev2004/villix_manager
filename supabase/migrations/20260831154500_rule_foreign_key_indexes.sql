create index payout_batches_rule_version_idx on public.payout_batches(rule_version);
create index initial_owners_claimed_by_idx on private.initial_owners(claimed_by) where claimed_by is not null;

analyze public.payout_batches;
