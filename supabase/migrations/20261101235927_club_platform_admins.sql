-- Permissions V1 stage E: platform admins. A platform-scope role assigned by the Super Admin, active only in an aal2
-- session from the account's own verified TOTP factor (no SQL Editor confirmation). Everything still goes through
-- club_private.can_platform(); Super-Admin-only powers are marked in the registry and can never reach any role.
-- Additive: existing function signatures are unchanged and the deployed Worker keeps working (pnpm test:compat).

-- 1. Registry marker. A super_admin_only permission is held by the active Super Admin alone: no role can be granted it,
-- and can_platform() never derives it from a role. Marking is a tightening; unmarking needs a new registry entry.
alter table public.auth_permissions add column super_admin_only boolean not null default false;
create or replace function club_private.registry_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare changed boolean;
begin
  -- Separate branches: PL/pgSQL resolves every field in an expression, even for the other table.
  if tg_table_name = 'auth_roles' then
    changed := (new.key, new.scope_kind, new.club_id, new.is_system) is distinct from (old.key, old.scope_kind, old.club_id, old.is_system);
  else
    changed := (new.key, new.kind, new.allowed_scopes, new.read_only) is distinct from (old.key, old.kind, old.allowed_scopes, old.read_only)
      or (old.non_delegable and not new.non_delegable) or (old.super_admin_only and not new.super_admin_only);
  end if;
  if changed then raise exception using errcode = '23514', message = '权限登记的标识和范围不可修改，请新增条目'; end if;
  return new;
end $$;
-- Same as 20261101195800, plus: a super_admin_only permission is never any role's permission.
create or replace function club_private.check_role_permission() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.auth_roles r join public.auth_permissions p on p.key = new.permission_key
                where r.key = new.role_key and r.scope_kind = any(p.allowed_scopes)) then
    raise exception using errcode = '23514', message = '此权限不能授予该范围的角色';
  end if;
  if new.role_key <> 'owner' and exists(select 1 from public.auth_permissions p join public.auth_roles r on r.key = new.role_key and r.scope_kind = 'club'
                                         where p.key = new.permission_key and p.non_delegable) then
    raise exception using errcode = '23514', message = '此权限仅限公会长，不能授予其他职位';
  end if;
  if exists(select 1 from public.auth_permissions where key = new.permission_key and super_admin_only) then
    raise exception using errcode = '23514', message = '此权限仅限超级管理员，不能授予任何职位';
  end if;
  return new;
end $$;
drop trigger auth_permissions_platform_audit on public.auth_permissions;
create trigger auth_permissions_platform_audit after insert or update or delete on public.auth_permissions
  for each row execute function club_private.platform_audit_row('key', 'kind', 'allowed_scopes', 'read_only', 'sensitive', 'non_delegable', 'super_admin_only', 'description');

-- Logged by the trigger above as migration changes.
update public.auth_permissions set super_admin_only = true where key in ('platform.clubs.admin_limit', 'platform.permissions.manage');
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, super_admin_only, description) values
  ('platform.platform_admins.assign', 'action', '{platform}', false, true, true, '任命或撤销平台管理员');
-- Platform admins: read the platform and manage club roles. Stage F registers alliance-leader appointment as one more
-- platform permission and grants it to this role here; alliance permissions and caps stay super_admin_only.
insert into public.auth_roles(key, scope_kind, is_system, name) values ('platform_admin', 'platform', true, '平台管理员');
insert into public.auth_role_permissions(role_key, permission_key) values ('platform_admin', 'platform.read'), ('platform_admin', 'platform.roles.assign');

-- 2. Platform role assignments. History is kept (status), like club memberships; written only by
-- platform_set_platform_admin(); no API role can read or change the table.
create table public.platform_role_assignments (
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null references public.auth_roles(key) on delete restrict,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.platform_role_assignments enable row level security;
revoke all on table public.platform_role_assignments from public, anon, authenticated, service_role;
create function club_private.check_platform_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.auth_roles where key = new.role and scope_kind = 'platform') then
    raise exception using errcode = '23514', message = '不是平台角色';
  end if;
  return new;
end $$;
revoke all on function club_private.check_platform_role() from public, anon, authenticated, service_role;
create trigger platform_role_assignments_scope before insert or update of role on public.platform_role_assignments
  for each row execute function club_private.check_platform_role();
create trigger platform_role_assignments_platform_audit after insert or update or delete on public.platform_role_assignments
  for each row execute function club_private.platform_audit_row('user_id', 'role', 'status', 'created_at');
create trigger platform_role_assignments_no_truncate before truncate on public.platform_role_assignments for each statement execute function club_private.audit_immutable();

-- 3. A platform admin's powers need an aal2 session whose factor is the account's own verified TOTP, an active
-- assignment and a confirmed email. Unlike super_admin_active(), no SQL Editor device confirmation is required.
create function club_private.platform_admin_active() returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then return false; end if;
  return exists(select 1 from public.platform_role_assignments a
      join auth.users u on u.id = a.user_id and u.email_confirmed_at is not null
      join auth.sessions ses on ses.id = (select case when auth.jwt()->>'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (auth.jwt()->>'session_id')::uuid end)
        and ses.user_id = a.user_id and ses.aal = 'aal2' and (ses.not_after is null or ses.not_after > now())
      join auth.mfa_factors f on f.id = ses.factor_id and f.user_id = a.user_id and f.status = 'verified' and f.factor_type = 'totp'
      join public.auth_roles r on r.key = a.role and r.scope_kind = 'platform'
      where a.user_id = (select auth.uid()) and a.status = 'active');
end $$;
revoke all on function club_private.platform_admin_active() from public, anon, authenticated, service_role;

-- The platform decision point (same signature). Active Super Admin: every registered platform permission, as before.
-- Anyone else: only what an active platform role grants, never a super_admin_only permission, and only while active.
create or replace function club_private.can_platform(p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'platform' = any(allowed_scopes))
    and (club_private.super_admin_active()
      or (exists(select 1 from public.auth_permissions where key = p_permission and not super_admin_only)
        and exists(select 1 from public.platform_role_assignments a
          join public.auth_roles r on r.key = a.role and r.scope_kind = 'platform'
          join public.auth_role_permissions rp on rp.role_key = a.role and rp.permission_key = p_permission
          where a.user_id = (select auth.uid()) and a.status = 'active')
        and club_private.platform_admin_active()));
$$;

-- 4. Role management. Same transaction (change_role); the authorization now accepts an active platform admin too.
create or replace function club_private.require_role_manager() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要平台角色管理权限，并在本次登录完成两步验证'; end if;
end $$;
-- Same as 20261101205005 except: a platform admin takes the manager path but never changes their own club role (no
-- self-promotion). The Super Admin path is unchanged; the owner path is unchanged.
-- Same as 20261101205005 except a platform-admin path. Order: active Super Admin (unchanged); the owner path (unchanged
-- rules) whenever the request has the owner shape and the caller holds club.admins.manage there, so a platform admin who
-- also owns the club is recorded in the club log like any owner; then an active platform admin, who never changes their
-- own club role (directly or by transferring away their own ownership). Volatile: the platform admin's assignment row is
-- locked, and a revocation committed meanwhile is seen (no row) and refused.
create or replace function club_private.require_role_change(p_club uuid, p_user uuid, p_role text, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare held text; owner_shape boolean := p_club is not null and p_user is not null and p_action is not null
  and p_action in ('grant', 'revoke', 'remove') and p_role is not distinct from (case when p_action = 'remove' then null else 'admin' end);
begin
  if club_private.can_platform('platform.roles.assign') and club_private.super_admin_active() then return 'manager'; end if;
  if owner_shape and club_private.can(p_club, 'club.admins.manage') then
    if p_user = (select auth.uid()) then raise exception using errcode = '42501', message = '不能修改自己的职位'; end if;
    select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active';
    if held is not null and held <> 'admin' then raise exception using errcode = '42501', message = '公会长只能管理本俱乐部的管理员'; end if;
    return 'owner';
  end if;
  if club_private.can_platform('platform.roles.assign') then
    if p_user = (select auth.uid()) or (p_action = 'transfer' and exists(select 1 from public.club_memberships
        where club_id = p_club and user_id = (select auth.uid()) and role = 'owner' and status = 'active')) then
      raise exception using errcode = '42501', message = '不能修改自己的职位';
    end if;
    perform 1 from public.platform_role_assignments where user_id = (select auth.uid()) and status = 'active' for share;
    if not found then perform club_private.require_role_manager(); end if;
    return 'manager';
  end if;
  perform club_private.require_role_manager(); -- raises the manager message for every other caller
  raise exception using errcode = '42501', message = '需要平台角色管理权限，并在本次登录完成两步验证';
end $$;

-- Same as 20261101205005 except: the owner path no longer refuses a Super Admin's account. A Super Admin's club role is
-- a club identity like any other (the Super Admin identity itself is untouched), and treating that account as "not
-- found" let anyone who also sees the confirmed accounts (a platform admin) tell who the Super Admin is.
create or replace function club_private.change_role(p_club uuid, p_user uuid, p_role text, p_action text, p_previous text, p_expected bigint, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); club public.club_clubs%rowtype; saved club_private.role_requests%rowtype;
  payload jsonb := jsonb_build_object('club', p_club, 'user', p_user, 'role', p_role, 'action', p_action, 'expected', p_expected)
    || case when p_previous is null then '{}'::jsonb else jsonb_build_object('previous', p_previous) end;
  held text; held_name text; owner_id uuid; changed boolean := false; response jsonb; via text;
begin
  via := club_private.require_role_change(p_club, p_user, p_role, p_action);
  if p_club is null or p_user is null or p_request is null or p_expected is null or p_expected < 0
    or p_action is null or p_action not in ('grant', 'revoke', 'transfer', 'remove')
    or (p_action = 'remove') <> (p_role is null) or (p_role is not null and p_role not in ('owner', 'admin'))
    or (p_action = 'transfer' and p_role <> 'owner')
    or (p_previous is not null and (p_action <> 'transfer' or p_previous not in ('admin', 'leave'))) then
    raise exception using errcode = '22023', message = '角色操作参数无效';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_request::text, 1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  -- A queued request must observe revocations (device, session or the owner's own role) made while waiting.
  via := club_private.require_role_change(p_club, p_user, p_role, p_action);
  select * into saved from club_private.role_requests where actor_id = actor and request_id = p_request;
  if found then
    if saved.payload <> payload then raise exception using errcode = 'PT409', message = '提交编号已用于其他角色操作'; end if;
    return saved.result;
  end if;
  select * into club from public.club_clubs where id = p_club for update;
  if not found then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  if club.role_version <> p_expected then raise exception using errcode = 'PT409', message = '角色已被修改，请刷新后重试'; end if;
  perform 1 from auth.users where id = p_user and (p_action in ('revoke', 'remove') or email_confirmed_at is not null) for share;
  if not found then
    raise exception using errcode = '22023', message = case when via = 'owner' then '找不到可任命的账户：请确认对方已注册网站账户并完成邮箱验证' else '目标账户不存在或邮箱尚未验证' end;
  end if;
  via := club_private.require_role_change(p_club, p_user, p_role, p_action);
  select m.role, coalesce(r.name, m.role) into held, held_name from public.club_memberships m left join public.auth_roles r on r.key = m.role
    where m.club_id = p_club and m.user_id = p_user and m.status = 'active';
  select user_id into owner_id from public.club_memberships where club_id = p_club and role = 'owner' and status = 'active';

  if p_action = 'grant' then
    if held is not null and held <> p_role then
      raise exception using errcode = 'PT409', message = format('该账户在此俱乐部已担任%s。同一俱乐部只能有一个职位，请先撤销原职位%s。',
        held_name, case when p_role = 'owner' and owner_id is not null then '，或使用转让公会长' else '' end);
    elsif held is null then
      if p_role = 'owner' and owner_id is not null then raise exception using errcode = 'PT409', message = '已有有效公会长，请使用转让'; end if;
      if p_role = 'admin' and (select count(*) from public.club_memberships where club_id = p_club and role = 'admin' and status = 'active') >= club.admin_limit then
        raise exception using errcode = 'PT409', message = format('有效管理员已达到人数上限（%s 人）', club.admin_limit);
      end if;
      insert into public.club_memberships(club_id, user_id, role, status) values (p_club, p_user, p_role, 'active')
        on conflict (club_id, user_id, role) do update set status = 'active';
      changed := true;
    end if;
  elsif p_action = 'revoke' then
    if held = p_role then
      if p_role = 'owner' then raise exception using errcode = 'PT409', message = '不能撤销有效公会长，请使用转让公会长'; end if;
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = p_user and role = p_role;
      changed := true;
    end if;
  elsif p_action = 'remove' then
    if held = 'owner' then raise exception using errcode = 'PT409', message = '该账户是此俱乐部的公会长，请先转让公会长再移出'; end if;
    if held is not null then
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = p_user and status = 'active';
      changed := true;
    end if;
  else
    if owner_id is null then raise exception using errcode = 'PT409', message = '尚无有效公会长，请使用任命'; end if;
    if owner_id = p_user then
      if p_previous is not null then raise exception using errcode = 'PT409', message = '该账户已是此俱乐部的公会长'; end if;
    else
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = p_user and status = 'active';
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = owner_id and role = 'owner';
      if p_previous = 'admin' then
        if (select count(*) from public.club_memberships where club_id = p_club and role = 'admin' and status = 'active') >= club.admin_limit then
          raise exception using errcode = 'PT409', message = format('原公会长改任管理员会超出管理员人数上限（%s 人），转让未执行', club.admin_limit);
        end if;
        insert into public.club_memberships(club_id, user_id, role, status) values (p_club, owner_id, 'admin', 'active')
          on conflict (club_id, user_id, role) do update set status = 'active';
      end if;
      insert into public.club_memberships(club_id, user_id, role, status) values (p_club, p_user, 'owner', 'active')
        on conflict (club_id, user_id, role) do update set status = 'active';
      changed := true;
    end if;
  end if;
  if not changed then
    insert into public.platform_audit_events(actor_id, action, details) values (actor, 'club_memberships.noop',
      jsonb_build_object('new', jsonb_build_object('club_id', p_club, 'user_id', p_user, 'role', coalesce(p_role, held), 'status', case when held is null then null else 'active' end)));
  elsif via = 'owner' then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, actor,
      case p_action when 'grant' then 'admin_appointed' when 'revoke' then 'admin_revoked' else 'admin_removed' end, p_user, '{}'::jsonb);
  end if;
  response := jsonb_build_object('changed', changed, 'role_version', (select role_version from public.club_clubs where id = p_club));
  insert into club_private.role_requests(actor_id, request_id, payload, result) values (actor, p_request, payload, response);
  return response;
end $$;


-- Same as 20261101205005 except the Super Admin's account is no longer left out (see change_role above).
create or replace function public.club_admin_candidate(p_club uuid, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare target uuid; target_email text;
begin
  if not club_private.can(p_club, 'club.admins.manage') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员的权限'; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 320 then raise exception using errcode = '22023', message = '请输入有效的邮箱'; end if;
  select u.id, u.email into target, target_email from auth.users u
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null
    order by u.id limit 1;
  if target is null then raise exception using errcode = '22023', message = '找不到可任命的账户：请确认对方已注册网站账户并完成邮箱验证'; end if;
  return jsonb_build_object('user_id', target, 'email', target_email,
    'role', (select role from public.club_memberships where club_id = p_club and user_id = target and status = 'active'),
    'role_name', (select r.name from public.club_memberships m join public.auth_roles r on r.key = m.role where m.club_id = p_club and m.user_id = target and m.status = 'active'),
    'kept', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description, 'sensitive', p.sensitive,
        'forced', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = target and permission_key = p.key and set_by = 'super_admin'),
        'owner_set', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = target and permission_key = p.key and set_by = 'owner'),
        'default_allowed', coalesce((select allowed from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p.key),
          exists(select 1 from public.auth_role_permissions where role_key = 'admin' and permission_key = p.key)),
        'allowed', club_private.layer_allows(club_private.permission_layer(p_club, target, 'admin', p.key))) order by p.key)
      from public.auth_permissions p
      where 'club' = any(p.allowed_scopes) and exists(select 1 from public.club_permission_overrides o where o.club_id = p_club and o.user_id = target and o.permission_key = p.key)), '[]'::jsonb));
end $$;


-- 5. Super Admin appoints or revokes platform admins. Never touches the Super Admin list (platform_super_admins
-- stays SQL Editor / migration only).
create function public.platform_set_platform_admin(p_user uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare held text; changed boolean := false;
begin
  if not club_private.can_platform('platform.platform_admins.assign') then raise exception using errcode = '42501', message = '只有超级管理员可以任命或撤销平台管理员'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以任命或撤销平台管理员'; end if;
  if p_user is null or p_action is null or p_action not in ('grant', 'revoke') then raise exception using errcode = '22023', message = '平台管理员操作参数无效'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform-role:' || p_user::text, 0));
  perform 1 from auth.users where id = p_user and (p_action = 'revoke' or email_confirmed_at is not null) for share;
  if not found then raise exception using errcode = '22023', message = '目标账户不存在或邮箱尚未验证'; end if;
  if p_action = 'grant' and exists(select 1 from public.platform_super_admins where user_id = p_user) then
    raise exception using errcode = 'PT409', message = '该账户是超级管理员，不需要平台管理员职位';
  end if;
  select status into held from public.platform_role_assignments where user_id = p_user and role = 'platform_admin';
  if p_action = 'grant' and held is distinct from 'active' then
    insert into public.platform_role_assignments(user_id, role) values (p_user, 'platform_admin')
      on conflict (user_id, role) do update set status = 'active';
    changed := true;
  elsif p_action = 'revoke' and held = 'active' then
    update public.platform_role_assignments set status = 'revoked' where user_id = p_user and role = 'platform_admin';
    changed := true;
  end if;
  return jsonb_build_object('changed', changed);
end $$;

-- 6. Readers. Who is a Super Admin (and their devices) is shown only to the active Super Admin; a platform admin sees
-- the same users and events with that identity removed. Otherwise identical to the previous definitions.
create function club_private.sees_super_admins() returns boolean language sql stable security definer set search_path = '' as $$
  select club_private.super_admin_active();
$$;
revoke all on function club_private.sees_super_admins() from public, anon, authenticated, service_role;

-- Same as 20261101195800, plus `platform_admin`; `super_admin` and membership `created_at` are present only for the
-- active Super Admin. A membership's created_at equals its audit event's time, so it would let a platform admin match a
-- Super Admin's masked log entries (see platform_activity) back to the account.
create or replace function public.platform_users(p_query text default null, p_after_key text default null, p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(nullif(btrim(coalesce(p_query, '')), '')); result jsonb; sees boolean := club_private.sees_super_admins();
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
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
      'platform_admin', exists(select 1 from public.platform_role_assignments a where a.user_id = v.id and a.role = 'platform_admin' and a.status = 'active'),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object('club_id', m.club_id, 'club_name', c.name, 'role', m.role, 'role_name', r.name, 'status', m.status, 'created_at', m.created_at)
          - case when sees then '' else 'created_at' end order by c.name, m.role)
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id left join public.auth_roles r on r.key = m.role where m.user_id = v.id), '[]'::jsonb),
      -- The same rule as club_private.can() for one user; supabase/tests/platform_admin.sql checks both agree.
      'effective', coalesce((select jsonb_agg(jsonb_build_object('club_id', e.club_id, 'club_name', e.club_name, 'permissions', to_jsonb(e.permissions)) order by e.club_name) from (
        select m.club_id, c.name as club_name, array_agg(distinct p.key order by p.key) as permissions
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id
        join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
        join public.auth_permissions p on 'club' = any(p.allowed_scopes)
          and club_private.layer_allows(club_private.permission_layer(m.club_id, m.user_id, m.role, p.key))
        where m.user_id = v.id and m.status = 'active' and v.email_confirmed_at is not null
        group by m.club_id, c.name) e), '[]'::jsonb)
    ) - case when sees then '' else 'super_admin' end order by v.k, v.id) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from matched) > 50 then (select jsonb_build_object('key', k, 'id', id) from visible order by k desc, id desc limit 1) end)
  into result;
  return result;
end $$;

-- Same as 20261031072234, except for viewers other than the active Super Admin (the stored rows never change):
-- changes to the Super Admin list and devices are not listed, and an event made by a Super Admin shows actor_kind
-- 'super_admin' with no actor email, no affected user (subject) and no user_id or created_at in its details. Hiding
-- the affected user of every such event, not only of the Super Admin's changes to their own account, keeps those
-- indistinguishable; created_at is removed because it equals the membership's own time.
create or replace function public.platform_activity(p_before timestamptz default null, p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; sees boolean := club_private.sees_super_admins();
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
  with page as (
    select * from public.platform_audit_events where (p_before is null or (created_at, id) < (p_before, p_id))
      and (sees or action not in ('platform_super_admins.insert', 'platform_super_admins.update', 'platform_super_admins.delete',
        'platform_super_admin_factors.insert', 'platform_super_admin_factors.update', 'platform_super_admin_factors.delete'))
    order by created_at desc, id desc limit 51
  ), visible as (select * from page order by created_at desc, id desc limit 50)
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'created_at', v.created_at, 'action', v.action, 'via', v.via,
        'details', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then v.details
          else coalesce((select jsonb_object_agg(k, case when jsonb_typeof(x) = 'object' then x - 'user_id' - 'created_at' else x end) from jsonb_each(v.details) d(k, x)), '{}'::jsonb) end,
        'actor', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then (select u.email from auth.users u where u.id = v.actor_id) end,
        'actor_kind', case when exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then 'super_admin' end,
        'subject', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then
          (select u.email from auth.users u where u.id = coalesce(v.details#>>'{new,user_id}', v.details#>>'{old,user_id}')::uuid) end,
        'club', (select c.name from public.club_clubs c where c.id = coalesce(v.details#>>'{new,club_id}', v.details#>>'{old,club_id}')::uuid)
      ) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from page) > 50 then (select jsonb_build_object('before', created_at, 'id', id) from visible order by created_at, id limit 1) end)
  into result;
  return result;
end $$;

-- Same as 20261031072234, except `assigned` also counts platform role assignments.
create or replace function public.platform_roles() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
  return jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'scopes', to_jsonb(allowed_scopes), 'read_only', read_only, 'sensitive', sensitive, 'description', description) order by key) from public.auth_permissions), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'scope', r.scope_kind, 'club_id', r.club_id, 'club_name', c.name, 'system', r.is_system,
        'permissions', coalesce((select jsonb_agg(rp.permission_key order by rp.permission_key) from public.auth_role_permissions rp where rp.role_key = r.key), '[]'::jsonb),
        'assigned', (select count(*) from public.club_memberships m where m.role = r.key and m.status = 'active')
          + (select count(*) from public.platform_role_assignments a where a.role = r.key and a.status = 'active'))
      order by r.scope_kind, r.club_id nulls first, r.is_system desc, r.key) from public.auth_roles r left join public.club_clubs c on c.id = r.club_id), '[]'::jsonb));
end $$;

-- Same as 20261101205005, except `super_admin` is present only for the active Super Admin.
create or replace function public.platform_permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
  return club_private.permission_explain(p_club, p_user) - case when club_private.sees_super_admins() then '' else 'super_admin' end;
end $$;

-- 7. The caller's own state for the Worker: `platform_admin` (listed, lets the account sign in and set up MFA without
-- any club role) and `platform_admin_active`. Otherwise identical to 20261031072234. club_my_context() is unchanged:
-- its platform_permissions already come from can_platform(), and sign-in reads club_my_access.
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
    'platform_admin', exists(select 1 from public.platform_role_assignments a join auth.users u on u.id = a.user_id
      where a.user_id = (select auth.uid()) and a.status = 'active' and u.email_confirmed_at is not null),
    'platform_admin_active', club_private.platform_admin_active(),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2',
    'platform_permissions', coalesce((select jsonb_agg(key order by key) from public.auth_permissions
      where 'platform' = any(allowed_scopes) and club_private.can_platform(key)), '[]'::jsonb));
$$;

revoke all on function public.platform_set_platform_admin(uuid, text) from public, anon, service_role;
grant execute on function public.platform_set_platform_admin(uuid, text) to authenticated;
