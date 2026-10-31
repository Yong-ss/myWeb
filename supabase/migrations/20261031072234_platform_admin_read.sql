-- P3 platform administration, read-only: one platform permission, Super Admin-only readers and a platform audit log.
-- Additive: no existing table, policy or write function changes; club_my_access only gains a field.

-- Append-only record of platform-level changes (role assignments, registry, Super Admin list, device confirmations),
-- including those made in SQL Editor. Only platform_activity() reads it; no API role can touch it.
create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The signed-in app user, or null for SQL Editor / migrations; `via` is the database login that made the change.
  actor_id uuid,
  via text not null default session_user,
  action text not null check (length(action) between 1 and 100),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index platform_audit_events_page on public.platform_audit_events(created_at desc, id desc);
alter table public.platform_audit_events enable row level security;
revoke all on table public.platform_audit_events from public, anon, authenticated, service_role;
create trigger platform_audit_immutable before update or delete on public.platform_audit_events for each row execute function club_private.audit_immutable();
create trigger platform_audit_no_truncate before truncate on public.platform_audit_events for each statement execute function club_private.audit_immutable();

-- One generic row trigger, so P4/P7 writers are audited without extra code. Each table's trigger lists the columns
-- it may log (trigger arguments); any other column, including ones added later, is never copied into the log.
create function club_private.platform_audit_fields(p_row jsonb, p_columns text[]) returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p_row) where key = any(p_columns);
$$;
create function club_private.platform_audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.platform_audit_events(actor_id, action, details) values ((select auth.uid()), tg_table_name || '.' || lower(tg_op),
    case tg_op when 'INSERT' then jsonb_build_object('new', club_private.platform_audit_fields(to_jsonb(new), tg_argv))
      when 'DELETE' then jsonb_build_object('old', club_private.platform_audit_fields(to_jsonb(old), tg_argv))
      else jsonb_build_object('old', club_private.platform_audit_fields(to_jsonb(old), tg_argv), 'new', club_private.platform_audit_fields(to_jsonb(new), tg_argv)) end);
  return null;
end $$;
revoke all on function club_private.platform_audit_fields(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function club_private.platform_audit_row() from public, anon, authenticated, service_role;
create trigger club_memberships_platform_audit after insert or update or delete on public.club_memberships
  for each row execute function club_private.platform_audit_row('club_id', 'user_id', 'role', 'status', 'created_at');
create trigger auth_roles_platform_audit after insert or update or delete on public.auth_roles
  for each row execute function club_private.platform_audit_row('key', 'scope_kind', 'club_id', 'is_system', 'name');
create trigger auth_role_permissions_platform_audit after insert or update or delete on public.auth_role_permissions
  for each row execute function club_private.platform_audit_row('role_key', 'permission_key');
create trigger auth_permissions_platform_audit after insert or update or delete on public.auth_permissions
  for each row execute function club_private.platform_audit_row('key', 'kind', 'allowed_scopes', 'read_only', 'sensitive', 'description');
create trigger platform_super_admins_platform_audit after insert or update or delete on public.platform_super_admins
  for each row execute function club_private.platform_audit_row('user_id', 'public_name', 'created_at');
create trigger platform_super_admin_factors_platform_audit after insert or update or delete on public.platform_super_admin_factors
  for each row execute function club_private.platform_audit_row('factor_id', 'user_id', 'factor_name', 'factor_created_at', 'trusted_at', 'trusted_by');
-- Device confirmations made before this log existed are real events; record them with their original time.
insert into public.platform_audit_events(created_at, via, action, details)
  select trusted_at, trusted_by, 'platform_super_admin_factors.insert',
    jsonb_build_object('new', club_private.platform_audit_fields(to_jsonb(t), array['factor_id', 'user_id', 'factor_name', 'factor_created_at', 'trusted_at', 'trusted_by']))
  from public.platform_super_admin_factors t;

-- Logged by the trigger above as a migration change.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description) values
  ('platform.read', 'action', '{platform}', true, true, '查看平台总览、全部用户、角色与平台日志');

-- The platform decision point. P3: only an active (MFA-verified, confirmed-device) Super Admin.
-- ponytail: P7 adds platform role assignments here, and must then mask the Super Admin in the readers below.
create function club_private.can_platform(p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'platform' = any(allowed_scopes))
    and club_private.super_admin_active();
$$;
revoke all on function club_private.can_platform(text) from public, anon, authenticated, service_role;

-- The Worker's per-request read gains the caller's platform permissions; everything else is unchanged.
create or replace function public.club_my_access(p_club uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'permissions', to_jsonb(public.club_my_permissions(p_club)),
    'roles', coalesce((select jsonb_agg(m.role order by m.role) from public.club_memberships m
      join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
      join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
      where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active'), '[]'::jsonb),
    'super_admin', exists(select 1 from public.platform_super_admins s join auth.users u on u.id = s.user_id
      where s.user_id = (select auth.uid()) and u.email_confirmed_at is not null),
    'super_admin_active', club_private.super_admin_active(),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2',
    'platform_permissions', coalesce((select jsonb_agg(key order by key) from public.auth_permissions
      where 'platform' = any(allowed_scopes) and club_private.can_platform(key)), '[]'::jsonb));
$$;

-- Platform overview with real counts. Alliances arrive in P6, so they are reported as not enabled (null), not zero.
-- ponytail: one row per club, unpaged; page it once clubs reach the hundreds.
create function public.platform_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'clubs', (select count(*) from public.club_clubs),
      'users', (select count(*) from auth.users),
      'confirmed_users', (select count(*) from auth.users where email_confirmed_at is not null),
      'members', (select count(distinct user_id) from public.club_memberships where status = 'active'),
      'active_roles', (select count(*) from public.club_memberships where status = 'active')),
    'alliances', null,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'created_at', c.created_at,
        'members', (select count(distinct m.user_id) from public.club_memberships m where m.club_id = c.id and m.status = 'active'),
        'players', (select count(*) from public.club_players p where p.club_id = c.id),
        'latest_snapshot', (select max(s.snapshot_date) from public.club_snapshots s where s.club_id = c.id and s.is_current and s.deleted_at is null)
      ) order by c.created_at, c.id) from public.club_clubs c), '[]'::jsonb));
end $$;

-- Users by email (or exact user ID), 50 per page. Only these auth.users fields are ever returned.
create function public.platform_users(p_query text default null, p_after_key text default null, p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(nullif(btrim(coalesce(p_query, '')), '')); result jsonb;
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  if length(q) > 100 then raise exception using errcode = '22023', message = '搜索内容过长'; end if;
  with matched as (
    select u.id, u.email, u.email_confirmed_at, u.created_at, u.last_sign_in_at, lower(coalesce(u.email, '')) as k from auth.users u
    where (q is null or u.id::text = q or strpos(lower(coalesce(u.email, '')), q) > 0)
      and (p_after_id is null or (lower(coalesce(u.email, '')), u.id) > (p_after_key, p_after_id))
    order by 6, 1 limit 51
  ), visible as (select * from matched order by k, id limit 50)
  select jsonb_build_object('users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'email', v.email, 'email_confirmed', v.email_confirmed_at is not null, 'created_at', v.created_at, 'last_sign_in_at', v.last_sign_in_at,
      'super_admin', exists(select 1 from public.platform_super_admins s where s.user_id = v.id),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object('club_id', m.club_id, 'club_name', c.name, 'role', m.role, 'role_name', r.name, 'status', m.status, 'created_at', m.created_at) order by c.name, m.role)
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id left join public.auth_roles r on r.key = m.role where m.user_id = v.id), '[]'::jsonb),
      -- The same rule as club_private.can() for one user; supabase/tests/platform_admin.sql checks both agree.
      'effective', coalesce((select jsonb_agg(jsonb_build_object('club_id', e.club_id, 'club_name', e.club_name, 'permissions', to_jsonb(e.permissions)) order by e.club_name) from (
        select m.club_id, c.name as club_name, array_agg(distinct rp.permission_key order by rp.permission_key) as permissions
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id
        join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
        join public.auth_role_permissions rp on rp.role_key = m.role
        join public.auth_permissions p on p.key = rp.permission_key and 'club' = any(p.allowed_scopes)
        where m.user_id = v.id and m.status = 'active' and v.email_confirmed_at is not null
        group by m.club_id, c.name) e), '[]'::jsonb)
    ) order by v.k, v.id) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from matched) > 50 then (select jsonb_build_object('key', k, 'id', id) from visible order by k desc, id desc limit 1) end)
  into result;
  return result;
end $$;

-- The registry as a read-only matrix: every permission, and every role with its permissions and active assignments.
create function public.platform_roles() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  return jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'scopes', to_jsonb(allowed_scopes), 'read_only', read_only, 'sensitive', sensitive, 'description', description) order by key) from public.auth_permissions), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'scope', r.scope_kind, 'club_id', r.club_id, 'club_name', c.name, 'system', r.is_system,
        'permissions', coalesce((select jsonb_agg(rp.permission_key order by rp.permission_key) from public.auth_role_permissions rp where rp.role_key = r.key), '[]'::jsonb),
        'assigned', (select count(*) from public.club_memberships m where m.role = r.key and m.status = 'active'))
      order by r.scope_kind, r.club_id nulls first, r.is_system desc, r.key) from public.auth_roles r left join public.club_clubs c on c.id = r.club_id), '[]'::jsonb));
end $$;

-- The platform log, newest first, 50 per page, with the affected user and club resolved for display.
create function public.platform_activity(p_before timestamptz default null, p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  with page as (
    select * from public.platform_audit_events where p_before is null or (created_at, id) < (p_before, p_id)
    order by created_at desc, id desc limit 51
  ), visible as (select * from page order by created_at desc, id desc limit 50)
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'created_at', v.created_at, 'action', v.action, 'via', v.via, 'details', v.details,
        'actor', (select u.email from auth.users u where u.id = v.actor_id),
        'subject', (select u.email from auth.users u where u.id = coalesce(v.details#>>'{new,user_id}', v.details#>>'{old,user_id}')::uuid),
        'club', (select c.name from public.club_clubs c where c.id = coalesce(v.details#>>'{new,club_id}', v.details#>>'{old,club_id}')::uuid)
      ) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from page) > 50 then (select jsonb_build_object('before', created_at, 'id', id) from visible order by created_at, id limit 1) end)
  into result;
  return result;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.platform_overview()','public.platform_users(text,text,uuid)','public.platform_roles()','public.platform_activity(timestamptz,uuid)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
