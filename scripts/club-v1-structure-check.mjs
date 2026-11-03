import { readFileSync } from 'node:fs';
import { functionChecksums } from './migration-checksums.mjs';

// Club permissions V1: prints a read-only SQL check of what the seven pending migrations must leave behind.
// Every problem is collected, then one exception lists them all, so psql -v ON_ERROR_STOP=1 exits non-zero
// (and, inside the deploy transaction, everything rolls back). Usage: node scripts/club-v1-structure-check.mjs > check.sql
export const migrations = ['20261101191854_club_single_role', '20261101195800_club_permission_layers', '20261101205005_club_owner_admins',
  '20261101235927_club_platform_admins', '20261102124404_club_alliances', '20261102171216_club_bulk_removal', '20261103090000_club_owner_grant_bound'];

// New tables: RLS on, no direct access for any API role (all access goes through definer functions).
const tables = ['auth_role_cap_blocks', 'club_role_permissions', 'club_permission_overrides', 'platform_role_assignments',
  'club_alliances', 'club_alliance_members', 'alliance_leaders', 'club_alliance_requests'];
// table: foreign keys -> referenced table
const fks = {
  auth_role_cap_blocks: 'auth_permissions,auth_roles', club_role_permissions: 'auth_permissions,auth_roles,club_clubs',
  club_permission_overrides: 'auth.users,auth_permissions,club_clubs', platform_role_assignments: 'auth.users,auth_roles',
  club_alliance_members: 'club_alliances,club_clubs', alliance_leaders: 'auth.users,club_alliances',
  club_alliance_requests: 'auth.users,auth.users,club_alliances,club_clubs',
};
// unique index: table (all partial unique indexes that enforce a business rule)
const uniques = { club_one_active_role: 'club_memberships', club_alliances_name: 'club_alliances', club_one_alliance: 'club_alliance_members',
  alliance_one_leader: 'alliance_leaders', alliance_leader_one_alliance: 'alliance_leaders', club_one_pending_alliance_request: 'club_alliance_requests' };
const triggers = { auth_permissions: 'auth_permissions_platform_audit', club_clubs: 'club_clubs_admin_limit_audit',
  ...Object.fromEntries(['auth_role_cap_blocks', 'club_role_permissions', 'club_permission_overrides'].map(t => [t, `${t}_check,${t}_platform_audit,${t}_no_truncate`])),
  platform_role_assignments: 'platform_role_assignments_scope,platform_role_assignments_platform_audit,platform_role_assignments_no_truncate',
  ...Object.fromEntries(['club_alliances', 'club_alliance_members', 'alliance_leaders', 'club_alliance_requests'].map(t => [t, `${t}_platform_audit,${t}_no_truncate`])) };
// Functions the migrations define: security definer?, executable by authenticated?, by service_role? (anon: never, checked for all)
const D = 'definer', I = 'invoker';
const functions = Object.entries({
  [I]: { none: 'caller_owner_holds layer_allows permission_layer' },
  [D]: {
    none: 'admin_limit_audit audit_actor can can_alliance can_alliance_read can_direct can_platform change_role check_permission_layer check_platform_role ' +
      'check_role_permission owner_settable permission_explain platform_admin_active registry_guard require_role_change require_role_manager sees_super_admins',
    authenticated: 'readable_clubs_direct public.alliance_decide_request public.club_admin_candidate public.club_alliance_status public.club_change_admin ' +
      'public.club_my_alliance public.club_request_alliance public.club_set_admin_default public.club_set_admin_permission public.club_team_admins ' +
      'public.club_team_permissions public.club_withdraw_alliance_request public.platform_activity public.platform_alliances public.platform_assign_role ' +
      'public.platform_overview public.platform_permission_explain public.platform_permission_settings public.platform_remove_from_all_clubs ' +
      'public.platform_remove_from_club public.platform_role_context public.platform_roles public.platform_save_alliance public.platform_set_admin_limit ' +
      'public.platform_set_alliance_leader public.platform_set_club_alliance public.platform_set_personal_permission public.platform_set_platform_admin ' +
      'public.platform_set_role_permission public.platform_transfer_owner public.platform_users',
    both: 'public.club_my_access',
  },
}).flatMap(([kind, groups]) => Object.entries(groups).flatMap(([who, names]) => names.split(' ').map(n =>
  [n.includes('.') ? n : `club_private.${n}`, kind === D, who === 'authenticated' || who === 'both', who === 'both'])));
// Registry rows the code depends on (security flags, not descriptions).
const nonDelegable = ['club.admins.manage', 'club.admins.permissions', 'club.alliance.request'];
const superAdminOnly = ['platform.clubs.admin_limit', 'platform.permissions.manage', 'platform.platform_admins.assign', 'platform.users.remove_all_clubs'];
const rolePermissions = ['owner:club.admins.manage', 'owner:club.admins.permissions', 'owner:club.alliance.request',
  'alliance_leader:alliance.joins.decide', 'alliance_leader:audit.read', 'alliance_leader:members.read',
  'platform_admin:platform.alliance_leaders.assign', 'platform_admin:platform.alliances.manage', 'platform_admin:platform.read', 'platform_admin:platform.roles.assign'];

// The newest definition of each function across the files is the one that must be deployed.
export function finalBodies(sources) {
  const last = new Map();
  for (const sql of sources) for (const f of functionChecksums(sql)) last.set(`${f.name}/${f.args}`, f);
  return [...last.values()];
}
const list = items => items.map(s => `'${s}'`).join(',');
const rows = (items, f) => items.map(f).join(',\n    ');

export function checkSql(sources) {
  return `-- Generated by scripts/club-v1-structure-check.mjs (read-only). Fails with a list of every problem.
do $check$
declare problems text[] := '{}'; r record;
begin
  -- Tables: exist, RLS enabled, no direct privilege for any API role.
  for r in select t, c.oid, c.relrowsecurity from unnest(array[${list(tables)}]) t left join pg_class c on c.oid = to_regclass('public.' || t) loop
    if r.oid is null then problems := problems || ('missing table ' || r.t); continue; end if;
    if not r.relrowsecurity then problems := problems || ('RLS off: ' || r.t); end if;
    if exists(select 1 from unnest(array['anon','authenticated','service_role']) g, unnest(array['select','insert','update','delete','truncate','references','trigger']) p
      where has_table_privilege(g, r.oid, p)) then problems := problems || ('API role has table privilege: ' || r.t); end if;
  end loop;
  -- Columns added to the registry.
  for r in select c from unnest(array['non_delegable','super_admin_only']) c loop
    if not exists(select 1 from pg_attribute where attrelid = 'public.auth_permissions'::regclass and attname = r.c and attnotnull and atttypid = 'boolean'::regtype and not attisdropped)
      then problems := problems || ('missing not-null boolean auth_permissions.' || r.c); end if;
  end loop;
  -- Foreign keys (referenced tables, sorted).
  for r in select * from (values
    ${rows(Object.entries(fks), ([t, refs]) => `('${t}','${refs}')`)}) e(t, refs) loop
    if (select string_agg(confrelid::regclass::text, ',' order by confrelid::regclass::text collate "C") from pg_constraint where conrelid = to_regclass('public.' || r.t) and contype = 'f') is distinct from r.refs
      then problems := problems || ('foreign keys differ on ' || r.t); end if;
  end loop;
  -- Partial unique indexes that enforce business rules.
  for r in select * from (values
    ${rows(Object.entries(uniques), ([i, t]) => `('${i}','${t}')`)}) e(i, t) loop
    if not exists(select 1 from pg_index x where x.indexrelid = to_regclass('public.' || r.i) and x.indrelid = to_regclass('public.' || r.t) and x.indisunique and x.indisvalid)
      then problems := problems || ('missing unique index ' || r.i); end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid = 'public.auth_permissions'::regclass and conname = 'auth_permissions_alliance_read_only' and contype = 'c')
    then problems := problems || 'missing check auth_permissions_alliance_read_only'::text; end if;
  -- RLS policy added by F: alliance readers never see raw imports.
  if not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'club_imports' and policyname = 'import_direct_readers'
    and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}' and with_check is null
    -- The exact condition (as PostgreSQL prints it), so a weakened USING such as true is not accepted.
    and qual = $q$(club_id IN ( SELECT club_private.readable_clubs_direct('members.read'::text) AS readable_clubs_direct))$q$) then problems := problems || 'missing restrictive policy club_imports.import_direct_readers'::text; end if;
  -- Triggers: present and enabled.
  for r in select e.t, g from (values
    ${rows(Object.entries(triggers), ([t, names]) => `('${t}','${names}')`)}) e(t, names), unnest(string_to_array(e.names, ',')) g loop
    if not exists(select 1 from pg_trigger where tgrelid = to_regclass('public.' || r.t) and tgname = r.g and tgenabled <> 'D')
      then problems := problems || ('missing or disabled trigger ' || r.t || '.' || r.g); end if;
  end loop;
  -- Functions: exist; definer as expected and owned like club_private.require; search_path=''; execute grants.
  for r in select e.*, p.oid, p.prosecdef, p.proconfig, p.proowner from (values
    ${rows(functions, ([n, d, a, s]) => `('${n}',${d},${a},${s})`)}) e(name, definer, auth, service)
    left join pg_proc p on p.proname = split_part(e.name, '.', 2) and p.pronamespace = split_part(e.name, '.', 1)::regnamespace loop
    if r.oid is null then problems := problems || ('missing function ' || r.name); continue; end if;
    if r.prosecdef is distinct from r.definer then problems := problems || ('security definer differs: ' || r.name); end if;
    if r.prosecdef and r.proowner <> (select proowner from pg_proc where oid = 'club_private.require'::regproc) then problems := problems || ('unexpected owner: ' || r.name); end if;
    if r.proconfig is distinct from array['search_path=""'] then problems := problems || ('search_path not empty: ' || r.name); end if;
    if has_function_privilege('authenticated', r.oid, 'execute') is distinct from r.auth then problems := problems || ('authenticated execute differs: ' || r.name); end if;
    if has_function_privilege('service_role', r.oid, 'execute') is distinct from r.service then problems := problems || ('service_role execute differs: ' || r.name); end if;
  end loop;
  -- Whole schemas: anon executes nothing; every definer function pins search_path.
  for r in select p.oid::regprocedure::text f, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'club_private'::regnamespace) loop
    if r.anon then problems := problems || ('anon can execute ' || r.f); end if;
    if r.prosecdef and r.proconfig is distinct from array['search_path=""'] then problems := problems || ('definer without empty search_path: ' || r.f); end if;
  end loop;
  -- Function bodies equal the final definition in the migration files.
  for r in select e.*, p.prosrc from (values
    ${rows(finalBodies(sources), f => `('${f.name}',${f.args},'${f.md5}')`)}) e(name, args, md5)
    left join pg_proc p on p.proname = split_part(e.name, '.', 2) and p.pronamespace = split_part(e.name, '.', 1)::regnamespace and p.pronargs = e.args loop
    if r.prosrc is null or md5(r.prosrc) <> r.md5 then problems := problems || ('function body differs: ' || r.name || '/' || r.args); end if;
  end loop;
  -- Registry security flags.
  if (select array_agg(key order by key) from public.auth_permissions where non_delegable) is distinct from array[${list(nonDelegable)}]
    then problems := problems || 'non_delegable permissions differ'::text; end if;
  if (select array_agg(key order by key) from public.auth_permissions where super_admin_only) is distinct from array[${list(superAdminOnly)}]
    then problems := problems || 'super_admin_only permissions differ'::text; end if;
  if exists(select 1 from public.auth_role_permissions rp join public.auth_permissions p on p.key = rp.permission_key where p.super_admin_only)
    then problems := problems || 'a role holds a super_admin_only permission'::text; end if;
  if (select count(*) from public.auth_roles where (key, scope_kind) in (('platform_admin','platform'),('alliance_leader','alliance'))) <> 2
    then problems := problems || 'roles platform_admin / alliance_leader missing'::text; end if;
  for r in select x from unnest(array[${list(rolePermissions)}]) x loop
    if not exists(select 1 from public.auth_role_permissions where role_key || ':' || permission_key = r.x) then problems := problems || ('missing role permission ' || r.x); end if;
  end loop;
  if cardinality(problems) > 0 then raise exception 'Club V1 structure check failed (% problems): %', cardinality(problems), array_to_string(problems, '; '); end if;
  raise notice 'Club V1 structure check passed';
end $check$;
`;
}
if (import.meta.main ?? process.argv[1]?.endsWith('club-v1-structure-check.mjs'))
  console.log(checkSql(migrations.map(m => readFileSync(new URL(`../supabase/migrations/${m}.sql`, import.meta.url), 'utf8'))));
