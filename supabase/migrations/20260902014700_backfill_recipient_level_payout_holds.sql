update public.payout_recipients as recipient
set
  status = 'held',
  hold_reason = case
    when profile.person_id is null or profile.onboarding_status is distinct from 'ready'
      then 'Bank onboarding is incomplete.'
    else 'A verified RazorpayX fund account is required.'
  end,
  held_at = coalesce(recipient.held_at, now())
from public.people as person
left join public.payee_profiles as profile on profile.person_id = person.id
where recipient.person_id = person.id
  and recipient.status = 'ready'
  and (
    profile.person_id is null
    or profile.onboarding_status is distinct from 'ready'
    or profile.payout_provider is distinct from 'razorpayx'
    or profile.provider_recipient_id is null
  );

update public.payout_recipients as recipient
set
  status = 'ready',
  hold_reason = null,
  held_at = null
from public.payee_profiles as profile
where recipient.person_id = profile.person_id
  and recipient.status = 'held'
  and profile.onboarding_status = 'ready'
  and profile.payout_provider = 'razorpayx'
  and profile.provider_recipient_id is not null;

analyze public.payout_recipients;
