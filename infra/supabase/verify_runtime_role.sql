-- Read-only certification for the MyPetNew runtime database identity.
-- Every boolean in the `must_be_false` group must remain false.

select
  rolname,
  rolsuper as must_be_false_superuser,
  rolcreatedb as must_be_false_createdb,
  rolcreaterole as must_be_false_createrole,
  rolreplication as must_be_false_replication,
  rolbypassrls as must_be_false_bypassrls,
  rolcanlogin
from pg_roles
where rolname = 'mypet_runtime';

select
  has_database_privilege('mypet_runtime', current_database(), 'CREATE')
    as must_be_false_database_create,
  has_schema_privilege('mypet_runtime', 'mypet', 'CREATE')
    as must_be_false_mypet_schema_create,
  has_schema_privilege('mypet_runtime', 'mypet', 'USAGE')
    as must_be_true_mypet_schema_usage;

select count(*) as must_be_zero_owned_mypet_tables
from pg_tables
where schemaname = 'mypet'
  and tableowner = 'mypet_runtime';

select count(*) as must_be_zero_owned_mypet_sequences
from pg_sequences
where schemaname = 'mypet'
  and sequenceowner = 'mypet_runtime';

-- Show the effective DML footprint for review. The runtime role may have the DML
-- privileges required by Spring Boot, but it must not own the application objects.
select
  privilege_type,
  count(*) as grant_count
from information_schema.role_table_grants
where grantee = 'mypet_runtime'
  and table_schema = 'mypet'
group by privilege_type
order by privilege_type;
