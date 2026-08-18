-- ===========================================================================
--  Supabase hardening. Idempotent: re-running it is safe.
--
--  ORDER (this is how the Unamargo instance was set up on 2026-08-18):
--    1. Run section 1 BEFORE `npm run db:migrate`, so the tables are never
--       granted to anon in the first place instead of being granted and then
--       revoked.
--    2. `npm run db:migrate`
--    3. Run sections 2 and 3, then the verification block.
--  Running the whole file after the migration also works; it just leaves a
--  short window where the tables carry the default grants.
--
--  Why this exists
--  ---------------
--  This app talks plain Postgres (Drizzle + postgres-js). It does NOT use
--  PostgREST, supabase-js, Supabase Auth or Storage. But Supabase auto-exposes
--  the `public` schema through the Data API, and on existing projects it
--  grants select/insert/update/delete on public tables to `anon` and
--  `authenticated` by default. Tables created by SQL migrations do NOT get RLS
--  enabled (only the ones created from the Dashboard do). Left as-is,
--  `users.password_hash` is readable with the anon key, which is meant to be
--  public.
--
--  Step 0 (Dashboard, not here): turn the Data API OFF. With it off, no
--  auto-generated REST endpoint responds regardless of grants or RLS. This
--  file is defense in depth for when someone turns it back on.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Stop future objects from being granted automatically.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Remove the grants the existing tables already have.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enable RLS with no policies: a third layer, and it silences the
--    "RLS disabled in public" advisor warning so a real one stays visible.
--
--    This does NOT lock the app out. The app connects as `postgres`, which
--    owns these tables, and a table owner is exempt from RLS unless the table
--    is set to FORCE ROW LEVEL SECURITY (which we never do). Postgres roles
--    with bypassrls are exempt too. `anon` is neither, so for `anon` these
--    tables become empty: no policies means no rows match.
-- ---------------------------------------------------------------------------
alter table public.users            enable row level security;
alter table public.settings         enable row level security;
alter table public.products         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.cash_categories  enable row level security;
alter table public.cash_movements   enable row level security;
alter table public.alert_events     enable row level security;

-- ===========================================================================
--  VERIFICATION. Run these after the block above and read the output.
-- ===========================================================================

-- (a) Must return ZERO rows. Any row = a table still reachable by anon.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee;

-- (b) Must list the 7 tables with rowsecurity = true and forcerowsecurity =
--     false. `forcerowsecurity = true` would lock the app out: do not set it.
select c.relname                as tablename,
       c.relrowsecurity         as rowsecurity,
       c.relforcerowsecurity    as forcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- (c) Sanity check that the app's own role is still the owner and is exempt.
--     Expect: current_user = postgres, and one row per table owned by it.
select current_user as connected_as;

select tablename, tableowner
from pg_tables
where schemaname = 'public'
order by tablename;
