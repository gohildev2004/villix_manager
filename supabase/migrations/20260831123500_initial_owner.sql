create table private.initial_owners (
  email extensions.citext primary key,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on table private.initial_owners from public, anon, authenticated;

create or replace function private.handle_initial_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.initial_owners
    where email = new.email
  ) then
    insert into public.admin_users (user_id, email, display_name, role, active)
    values (
      new.id,
      new.email,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
      'owner',
      true
    )
    on conflict (user_id) do update
      set email = excluded.email,
          display_name = excluded.display_name,
          role = 'owner',
          active = true;

    update private.initial_owners
    set claimed_by = new.id,
        claimed_at = now()
    where email = new.email;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_initial_owner() from public, anon, authenticated;

create trigger villix_initial_owner_created
after insert on auth.users
for each row execute function private.handle_initial_owner();

insert into public.admin_users (user_id, email, display_name, role, active)
select
  users.id,
  users.email,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), users.email),
  'owner',
  true
from auth.users as users
join private.initial_owners as owners on owners.email = users.email
where users.email is not null
on conflict (user_id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    role = 'owner',
    active = true;

update private.initial_owners as owners
set claimed_by = users.id,
    claimed_at = coalesce(owners.claimed_at, now())
from auth.users as users
where owners.email = users.email;
