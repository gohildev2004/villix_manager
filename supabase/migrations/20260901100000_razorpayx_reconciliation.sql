alter table public.payee_profiles
  add column provider_contact_id text;

create unique index payee_profiles_provider_contact_id_idx
  on public.payee_profiles(provider_contact_id)
  where provider_contact_id is not null;

alter table public.payment_attempts
  add column provider_status text,
  add column provider_status_details jsonb;

create table public.provider_webhook_events (
  event_id text primary key,
  provider text not null check (provider in ('razorpayx')),
  event_type text not null,
  provider_reference text,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index provider_webhook_events_reference_idx
  on public.provider_webhook_events(provider, provider_reference)
  where provider_reference is not null;

create index provider_webhook_events_received_at_idx
  on public.provider_webhook_events(received_at desc);

alter table public.provider_webhook_events enable row level security;

create policy "villix_admin_read_provider_webhooks"
  on public.provider_webhook_events
  for select
  to authenticated
  using ((select private.is_villix_admin()));

grant select on public.provider_webhook_events to authenticated;
revoke insert, update, delete on public.provider_webhook_events from authenticated;

comment on table public.provider_webhook_events is
  'Idempotency and processing ledger for signed payment-provider webhooks. Raw provider payloads are not retained.';
comment on column public.payee_profiles.provider_contact_id is
  'RazorpayX Contact identifier. Bank details are never stored in Villix Manager.';

analyze public.payee_profiles;
analyze public.payment_attempts;
analyze public.provider_webhook_events;
