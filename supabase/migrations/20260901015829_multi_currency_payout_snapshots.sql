alter table public.payout_batches
  add column exchange_rate numeric(18, 6),
  add column settlement_adjustment_bps integer not null default 0,
  add column total_gross_settlement_cents bigint not null default 0,
  add column total_retained_settlement_cents bigint not null default 0,
  add column total_payable_settlement_cents bigint not null default 0,
  add column payout_provider text not null default 'razorpayx',
  add constraint payout_batches_exchange_rate_check check (exchange_rate is null or exchange_rate > 0),
  add constraint payout_batches_adjustment_check check (settlement_adjustment_bps between 0 and 10000),
  add constraint payout_batches_settlement_split_check check (
    total_gross_settlement_cents = total_retained_settlement_cents + total_payable_settlement_cents
  );

alter table public.payout_recipients
  add column gross_settlement_cents bigint not null default 0,
  add column retained_settlement_cents bigint not null default 0,
  add column payable_settlement_cents bigint not null default 0,
  add column payout_currency char(3) not null default 'INR',
  add column payout_amount_minor bigint not null default 0,
  add column payout_fx_rate numeric(18, 6),
  add column payout_provider text,
  add constraint payout_recipients_settlement_split_check check (
    gross_settlement_cents = retained_settlement_cents + payable_settlement_cents
  ),
  add constraint payout_recipients_payout_amount_check check (payout_amount_minor >= 0),
  add constraint payout_recipients_payout_fx_rate_check check (payout_fx_rate is null or payout_fx_rate > 0);

alter table public.payment_attempts
  add column currency char(3) not null default 'INR';

comment on column public.payout_batches.exchange_rate is 'Locked INR received per one USD source unit before the optional adjustment.';
comment on column public.payout_batches.settlement_adjustment_bps is 'Explicit weekly settlement adjustment. Zero unless an actual deduction is recorded.';
comment on column public.payout_recipients.payout_currency is 'Recipient destination currency selected on the person record at approval time.';
comment on column public.payout_recipients.payout_fx_rate is 'Locked settlement-currency units per one destination-currency unit; 1 for matching currencies.';

analyze public.payout_batches;
analyze public.payout_recipients;
analyze public.payment_attempts;
