-- Permissions V1 stage C: an owner manages the admins of their own club. Supersedes DECISIONS "P4: owner cannot
-- manage assignments". Additive: no function signature the deployed Worker calls changes; change_role and
-- platform_permission_explain keep their signatures and, for every existing caller, their behaviour.

-- 1. Two non-delegable management powers. The stage B safety layer (permission_layer: non_delegable) and the registry
-- triggers keep them away from every role but the owner, whatever any default, cap or override says.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, non_delegable, description) values
  ('club.admins.manage', 'action', '{club}', false, true, true, '任命、撤销和移出本俱乐部的管理员'),
  ('club.admins.permissions', 'action', '{club}', false, true, true, '修改本俱乐部管理员的默认权限和个人权限');
insert into public.auth_role_permissions(role_key, permission_key) values ('owner', 'club.admins.manage'), ('owner', 'club.admins.permissions');

-- 2. Who may run a club role change. An active Super Admin with platform.roles.assign: anything (stage A rules).
-- Otherwise only the owner path: grant/revoke/remove of the admin role, with club.admins.manage in that club, never on
-- themselves, never appointing a Super Admin, and only on someone who holds no role or the admin role there.
-- No row locks here: change_role calls this again while holding the club lock, which every role change takes.
create function club_private.require_role_change(p_club uuid, p_user uuid, p_role text, p_action text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare held text;
begin
  if club_private.can_platform('platform.roles.assign') and club_private.super_admin_active() then return 'manager'; end if;
  if p_club is null or p_user is null or p_action is null or p_action not in ('grant', 'revoke', 'remove')
    or p_role is distinct from (case when p_action = 'remove' then null else 'admin' end)
    or not club_private.can(p_club, 'club.admins.manage') then
    perform club_private.require_role_manager(); -- raises the Super Admin message unchanged for every other caller
  end if;
  if p_user = (select auth.uid()) then raise exception using errcode = '42501', message = '不能修改自己的职位'; end if;
  select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active';
  if held is not null and held <> 'admin' then raise exception using errcode = '42501', message = '公会长只能管理本俱乐部的管理员'; end if;
  return 'owner';
end $$;

-- Same as 20261101191854 except: authorization goes through require_role_change (the Super Admin path is exactly
-- require_role_manager as before), and an owner's change is also written to the club log in the same transaction.
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
  -- An owner may never appoint a Super Admin. Checked here, after the version and account checks, so the answer and its
  -- order are exactly those of an unknown or unverified account: the owner path never reveals who is a Super Admin.
  if found and via = 'owner' and p_action = 'grant' and exists(select 1 from public.platform_super_admins where user_id = p_user) then
    raise exception using errcode = '22023', message = '找不到可任命的账户：请确认对方已注册网站账户并完成邮箱验证';
  end if;
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

-- 3. The stage B explanation, shared by the platform and owner readers (one calculation, two authorizations).
create function club_private.permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare held text; confirmed boolean;
begin
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  select email_confirmed_at is not null into confirmed from auth.users where id = p_user;
  if not found then raise exception using errcode = '22023', message = '目标账户不存在'; end if;
  select m.role into held from public.club_memberships m
    join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
    where m.club_id = p_club and m.user_id = p_user and m.status = 'active';
  return jsonb_build_object('club_id', p_club, 'user_id', p_user, 'role', held, 'role_name', (select name from public.auth_roles where key = held),
    'email_confirmed', confirmed, 'super_admin', exists(select 1 from public.platform_super_admins where user_id = p_user),
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description, 'sensitive', p.sensitive, 'non_delegable', p.non_delegable,
        'layer', x.layer, 'allowed', confirmed and club_private.layer_allows(x.layer),
        'platform_default', exists(select 1 from public.auth_role_permissions where role_key = held and permission_key = p.key),
        'cap_blocked', exists(select 1 from public.auth_role_cap_blocks where role_key = held and permission_key = p.key),
        'club_default', (select allowed from public.club_role_permissions where club_id = p_club and role_key = held and permission_key = p.key),
        'forced', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p.key and set_by = 'super_admin'),
        'owner_set', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p.key and set_by = 'owner')
      ) order by p.key)
      from public.auth_permissions p
      cross join lateral (select case when held is null then 'no_role' else club_private.permission_layer(p_club, p_user, held, p.key) end as layer) x
      where 'club' = any(p.allowed_scopes)), '[]'::jsonb));
end $$;
create or replace function public.platform_permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  return club_private.permission_explain(p_club, p_user);
end $$;

-- 4. Owner readers. Scoped to one club; never another club's data, never who is a Super Admin.
create function public.club_team_admins(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'club.admins.manage') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员的权限'; end if;
  return (select jsonb_build_object('club_id', c.id, 'admin_limit', c.admin_limit, 'role_version', c.role_version,
    'admins', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'email_confirmed', u.email_confirmed_at is not null) order by lower(u.email), m.user_id)
      from public.club_memberships m join auth.users u on u.id = m.user_id where m.club_id = c.id and m.role = 'admin' and m.status = 'active'), '[]'::jsonb))
    from public.club_clubs c where c.id = p_club);
end $$;

-- Admin-role settings of this club and each active admin's explanation (the stage B calculation, Super Admin flag removed).
create function public.club_team_permissions(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'club.admins.permissions') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员权限的权限'; end if;
  return jsonb_build_object('club_id', p_club,
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description, 'sensitive', p.sensitive, 'non_delegable', p.non_delegable,
        'cap_blocked', exists(select 1 from public.auth_role_cap_blocks where role_key = 'admin' and permission_key = p.key),
        'platform_default', exists(select 1 from public.auth_role_permissions where role_key = 'admin' and permission_key = p.key),
        'club_default', (select allowed from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p.key)) order by p.key)
      from public.auth_permissions p where 'club' = any(p.allowed_scopes)), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'explain', club_private.permission_explain(p_club, m.user_id) - 'super_admin') order by lower(u.email), m.user_id)
      from public.club_memberships m join auth.users u on u.id = m.user_id where m.club_id = p_club and m.role = 'admin' and m.status = 'active'), '[]'::jsonb));
end $$;

-- Before appointing: who the email belongs to and which kept personal settings (owner or Super Admin) would apply
-- again as admin in this club, with the final result each would have. Unknown, unverified and Super Admin accounts
-- all get the same answer.
create function public.club_admin_candidate(p_club uuid, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare target uuid; target_email text;
begin
  if not club_private.can(p_club, 'club.admins.manage') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员的权限'; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 320 then raise exception using errcode = '22023', message = '请输入有效的邮箱'; end if;
  select u.id, u.email into target, target_email from auth.users u
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null
      and not exists(select 1 from public.platform_super_admins s where s.user_id = u.id)
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

-- 5. Owner writers. Permission check first (no lock for outsiders), then the club lock, then require() as every
-- business writer does; one club audit row per real change, and the platform log via the table triggers.
-- p_action: grant (appoint as admin) | revoke (revoke the admin role) | remove (remove from this club).
create function public.club_change_admin(p_club uuid, p_user uuid, p_action text, p_expected bigint, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'club.admins.manage') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员的权限'; end if;
  if p_action is null or p_action not in ('grant', 'revoke', 'remove') then raise exception using errcode = '22023', message = '职位操作参数无效'; end if;
  return club_private.change_role(p_club, p_user, case when p_action = 'remove' then null else 'admin' end, p_action, null, p_expected, p_request);
end $$;

-- Shared checks for both owner permission writers: a club-scope, delegable permission within the admin cap.
create function club_private.owner_settable(p_club uuid, p_permission text, p_value boolean) returns public.auth_permissions
language plpgsql stable security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype;
begin
  if not club_private.can(p_club, 'club.admins.permissions') then raise exception using errcode = '42501', message = '没有管理本俱乐部管理员权限的权限'; end if;
  select * into perm from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes);
  if not found then raise exception using errcode = '22023', message = '权限不存在'; end if;
  if perm.non_delegable then raise exception using errcode = 'PT409', message = '此权限仅限公会长，不能授予管理员（系统安全规则）'; end if;
  if p_value is not null and exists(select 1 from public.auth_role_cap_blocks where role_key = 'admin' and permission_key = p_permission) then
    raise exception using errcode = 'PT409', message = '超级管理员已限制管理员拥有此权限（职位权限上限），不能修改';
  end if;
  return perm;
end $$;

-- This club's default for the admin role; null = follow the platform default again.
create function public.club_set_admin_default(p_club uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; old boolean; n integer; platform boolean;
begin
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  perform club_private.require(p_club, 'club.admins.permissions');
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  select allowed into old from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p_permission;
  platform := exists(select 1 from public.auth_role_permissions where role_key = 'admin' and permission_key = p_permission);
  -- Owner-confirmed rule (2026-11-02): an owner never grants admins what they do not hold here themselves. An explicit
  -- allow always counts (it pins the permission even if the platform default later changes); following the platform
  -- counts when it turns the admin default from deny into allow ("不允许 → 跟随全平台").
  if (p_value is true or (p_value is null and platform and not coalesce(old, platform))) and not club_private.can(p_club, p_permission) then
    raise exception using errcode = '42501', message = '不能授予你自己没有的权限';
  end if;
  if p_value is null then delete from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p_permission;
  else insert into public.club_role_permissions(club_id, role_key, permission_key, allowed) values (p_club, 'admin', p_permission, p_value)
    on conflict (club_id, role_key, permission_key) do update set allowed = excluded.allowed where club_role_permissions.allowed is distinct from excluded.allowed; end if;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, auth.uid(), 'admin_default_changed', null,
      jsonb_build_object('permission', p_permission, 'description', perm.description, 'old', old, 'new', p_value));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

-- An owner-level personal setting (set_by 'owner') for one active admin of this club; null = follow the defaults.
-- Super Admin forced settings and caps still win (permission_layer); the owner can never target themselves.
create function public.club_set_admin_permission(p_club uuid, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; old boolean; held text; n integer; was boolean;
begin
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  if p_user is null then raise exception using errcode = '22023', message = '目标账户无效'; end if;
  if p_user = (select auth.uid()) then raise exception using errcode = '42501', message = '不能修改自己的权限'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  perform club_private.require(p_club, 'club.admins.permissions');
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active' for share;
  if held is distinct from 'admin' then raise exception using errcode = 'PT409', message = '只能为本俱乐部的有效管理员设置个人权限'; end if;
  select allowed into old from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'owner';
  was := club_private.layer_allows(club_private.permission_layer(p_club, p_user, 'admin', p_permission));
  if p_value is null then delete from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'owner';
  else insert into public.club_permission_overrides(club_id, user_id, permission_key, set_by, allowed) values (p_club, p_user, p_permission, 'owner', p_value)
    on conflict (club_id, user_id, permission_key, set_by) do update set allowed = excluded.allowed where club_permission_overrides.allowed is distinct from excluded.allowed; end if;
  get diagnostics n = row_count;
  -- Same rule for one admin: an explicit allow always counts; "单独禁止 → 跟随默认" counts when this admin's final result
  -- (caps and Super Admin settings included) turns from deny into allow. The raise rolls the change back.
  if (p_value is true or (not was and club_private.layer_allows(club_private.permission_layer(p_club, p_user, 'admin', p_permission))))
    and not club_private.can(p_club, p_permission) then
    raise exception using errcode = '42501', message = '不能授予你自己没有的权限';
  end if;
  if n > 0 then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, auth.uid(), 'admin_permission_changed', p_user,
      jsonb_build_object('permission', p_permission, 'description', perm.description, 'old', old, 'new', p_value));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

revoke all on function club_private.require_role_change(uuid, uuid, text, text), club_private.permission_explain(uuid, uuid),
  club_private.owner_settable(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.club_team_admins(uuid), public.club_team_permissions(uuid), public.club_admin_candidate(uuid, text),
  public.club_change_admin(uuid, uuid, text, bigint, uuid), public.club_set_admin_default(uuid, text, boolean),
  public.club_set_admin_permission(uuid, uuid, text, boolean) from public, anon, service_role;
grant execute on function public.club_team_admins(uuid), public.club_team_permissions(uuid), public.club_admin_candidate(uuid, text),
  public.club_change_admin(uuid, uuid, text, bigint, uuid), public.club_set_admin_default(uuid, text, boolean),
  public.club_set_admin_permission(uuid, uuid, text, boolean) to authenticated;
