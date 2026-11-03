-- Club V1 production read-only precheck. Not executed by AI. Owner runs it only after separate approval.
-- Read only: one READ ONLY transaction, rolled back at the end. Every row should show ok = true.
begin transaction read only;
select 'P1 all 15 deployed migrations recorded (missing listed)' as item,
  (select string_agg(v, ',') from unnest(array['20261027061948','20261027064338','20261027101032','20261028021000','20261028040000','20261028133444',
    '20261028140238','20261028142025','20261030014019','20261030051258','20261030093737','20261031072234','20261031111245','20261031134904',
    '20261101163647']) v where v not in (select version from supabase_migrations.schema_migrations)) as value,
  (select count(*) from supabase_migrations.schema_migrations where version in ('20261027061948','20261027064338','20261027101032','20261028021000',
    '20261028040000','20261028133444','20261028140238','20261028142025','20261030014019','20261030051258','20261030093737','20261031072234',
    '20261031111245','20261031134904','20261101163647')) = 15 as ok
union all select 'P2 pending V1 migrations not applied yet',
  (select string_agg(version, ',') from supabase_migrations.schema_migrations where version >= '20261101191854'),
  not exists(select 1 from supabase_migrations.schema_migrations where version >= '20261101191854')
union all select 'P3 A stops if a user has 2+ non-owner active roles in one club',
  (select count(*)::text from (select club_id, user_id from public.club_memberships where status = 'active' and role <> 'owner'
    group by club_id, user_id having count(*) > 1) x), not exists(select 1 from public.club_memberships where status = 'active' and role <> 'owner'
    group by club_id, user_id having count(*) > 1)
union all select 'P4 owner+admin double roles A will revoke (informational)',
  (select count(*)::text from public.club_memberships m where m.status = 'active' and m.role <> 'owner' and exists(select 1 from public.club_memberships o
    where o.club_id = m.club_id and o.user_id = m.user_id and o.role = 'owner' and o.status = 'active')), true
union all select 'P5 clubs without an active owner',
  (select string_agg(c.id::text, ',') from public.club_clubs c where not exists(select 1 from public.club_memberships m
    where m.club_id = c.id and m.role = 'owner' and m.status = 'active')),
  not exists(select 1 from public.club_clubs c where not exists(select 1 from public.club_memberships m
    where m.club_id = c.id and m.role = 'owner' and m.status = 'active'))
union all select 'P6 F drops constraint auth_permissions_check (must exist)',
  (select string_agg(conname, ',') from pg_constraint where conrelid = 'public.auth_permissions'::regclass and contype = 'c'),
  exists(select 1 from pg_constraint where conrelid = 'public.auth_permissions'::regclass and conname = 'auth_permissions_check')
union all select 'P7 new roles not present yet',
  (select string_agg(key, ',') from public.auth_roles where key in ('platform_admin', 'alliance_leader')),
  not exists(select 1 from public.auth_roles where key in ('platform_admin', 'alliance_leader'))
union all select 'P8 new permission keys not present yet',
  (select string_agg(key, ',') from public.auth_permissions where key in ('alliance.joins.decide', 'club.admins.manage', 'club.admins.permissions',
    'club.alliance.request', 'platform.alliance_leaders.assign', 'platform.alliances.manage', 'platform.platform_admins.assign', 'platform.users.remove_all_clubs')),
  not exists(select 1 from public.auth_permissions where key in ('alliance.joins.decide', 'club.admins.manage', 'club.admins.permissions',
    'club.alliance.request', 'platform.alliance_leaders.assign', 'platform.alliances.manage', 'platform.platform_admins.assign', 'platform.users.remove_all_clubs'))
union all select 'P9 V1 tables not present yet',
  (select string_agg(relname, ',') from pg_class where relnamespace = 'public'::regnamespace and relname in ('auth_role_cap_blocks', 'club_role_permissions',
    'club_permission_overrides', 'platform_role_assignments', 'club_alliances', 'club_alliance_members', 'alliance_leaders', 'club_alliance_requests')),
  not exists(select 1 from pg_class where relnamespace = 'public'::regnamespace and relname in ('auth_role_cap_blocks', 'club_role_permissions',
    'club_permission_overrides', 'platform_role_assignments', 'club_alliances', 'club_alliance_members', 'alliance_leaders', 'club_alliance_requests'))
union all select 'P10 super admins / confirmed TOTP factors (compare with expectation)',
  (select count(*) from public.platform_super_admins)::text || ' / ' || (select count(*) from public.platform_super_admin_factors)::text, true
union all select 'P11 default privileges in public for postgres (informational)',
  (select string_agg(defaclobjtype::text || ':' || array_to_string(defaclacl, ' '), ' | ') from pg_default_acl
    where defaclnamespace = 'public'::regnamespace and defaclrole = 'postgres'::regrole), true;
rollback;
