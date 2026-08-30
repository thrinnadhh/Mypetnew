-- MyPetNew legacy Captain public-surface lockdown.
--
-- DO NOT run until:
--   1) a verified logical backup exists,
--   2) the exact-head Captain regression suite is green,
--   3) repository search still confirms no dependency on these legacy tables.
--
-- This intentionally does NOT drop the tables. Phase 4 first removes public/anon
-- access, then re-certifies Captain behavior. Table quarantine/drop is a later step.

begin;

do $$
begin
  if (select count(*) from public.captain_locations) <> 0 then
    raise exception 'Refusing lockdown: public.captain_locations is not empty';
  end if;
  if (select count(*) from public.captain_onboarding) <> 0 then
    raise exception 'Refusing lockdown: public.captain_onboarding is not empty';
  end if;
  if (select count(*) from public.captain_support_tickets) <> 0 then
    raise exception 'Refusing lockdown: public.captain_support_tickets is not empty';
  end if;
end
$$;

drop policy if exists "Allow anon read/write for locations"
  on public.captain_locations;
drop policy if exists "Allow anon read/write for onboarding"
  on public.captain_onboarding;
drop policy if exists "Allow anon read/write for support"
  on public.captain_support_tickets;

revoke all privileges on table public.captain_locations from public, anon, authenticated;
revoke all privileges on table public.captain_onboarding from public, anon, authenticated;
revoke all privileges on table public.captain_support_tickets from public, anon, authenticated;

commit;

-- Postcondition checks (expected: zero rows from each query):
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('captain_locations', 'captain_onboarding', 'captain_support_tickets');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('captain_locations', 'captain_onboarding', 'captain_support_tickets')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;
