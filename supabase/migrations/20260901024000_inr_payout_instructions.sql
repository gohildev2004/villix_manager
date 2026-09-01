update public.people
set currency = 'INR'
where currency <> 'INR';

update public.payee_profiles
set currency = 'INR',
    country = 'IN',
    payout_provider = 'razorpayx'
where currency <> 'INR'
   or country <> 'IN'
   or payout_provider is distinct from 'razorpayx';

comment on column public.people.currency is 'Villix ledger and payout-instruction currency. Currently fixed to INR.';
comment on column public.payee_profiles.currency is 'Indian bank payout currency. Fixed to INR.';
comment on column public.payee_profiles.country is 'Beneficiary bank country. Villix payouts currently require IN.';
comment on column public.payout_recipients.payout_currency is 'Locked RazorpayX transfer currency. Fixed to INR.';
