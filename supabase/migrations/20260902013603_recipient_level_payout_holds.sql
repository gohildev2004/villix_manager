alter table public.payout_recipients
  drop constraint if exists payout_recipients_status_check;

alter table public.payout_recipients
  add constraint payout_recipients_status_check
  check (status in ('ready', 'held', 'processing', 'paid', 'failed', 'cancelled')),
  add column if not exists hold_reason text,
  add column if not exists held_at timestamptz;

alter table public.payout_recipients
  drop constraint if exists payout_recipients_hold_reason_length_check;

alter table public.payout_recipients
  add constraint payout_recipients_hold_reason_length_check
  check (hold_reason is null or char_length(hold_reason) <= 500);

create index if not exists idx_payout_recipients_batch_outstanding
  on public.payout_recipients (batch_id, status)
  where status in ('ready', 'held', 'processing', 'failed');

comment on column public.payout_recipients.hold_reason is
  'Human-readable reason this recipient was excluded from the current payout dispatch.';

comment on column public.payout_recipients.held_at is
  'Time this recipient entered a payout hold. Cleared when payout readiness is restored.';

analyze public.payout_recipients;
