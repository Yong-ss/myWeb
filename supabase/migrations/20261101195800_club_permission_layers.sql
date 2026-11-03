-- Permissions V1 stage B: permission layers, decided only inside club_private.can().
-- Layers, highest first: (1) system safety (registered club permission; non-delegable permissions only for the owner),
-- (2) Super Admin role caps, (3) Super Admin forced personal overrides, (4) owner-set personal overrides for admins,
-- (5) per-club role defaults, (6) platform role defaults = the existing auth_role_permissions.
-- Additive: with no rows in the new tables and no non-delegable permission, every result equals the previous can()
-- (supabase/tests/permission_layers.sql proves it). No existing function signature changes; the deployed Worker is unaffected.

-- 1. Registry marker. Non-delegable permissions (management powers, stage C) can never reach any role but the owner.
alter table public.auth_permissions add column non_delegable boolean not null default false;

-- Marking stays possible (a tightening); unmarking would silently widen admins, so it needs a new registry entry.
create or replace function club_private.registry_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare changed boolean;
begin
  -- Separate branches: PL/pgSQL resolves every field in an expression, even for the other table.
  if tg_table_name = 'auth_roles' then
    changed := (new.key, new.scope_kind, new.club_id, new.is_system) is distinct from (old.key, old.scope_kind, old.club_id, old.is_system);
  else
    changed := (new.key, new.kind, new.allowed_scopes, new.read_only) is distinct from (old.key, old.kind, old.allowed_scopes, old.read_only)
      or (old.non_delegable and not new.non_delegable);
  end if;
  if changed then raise exception using errcode = '23514', message = '权限登记的标识和范围不可修改，请新增条目'; end if;
  return new;
end $$;

-- Platform defaults: scope as before, and a non-delegable permission is never a default of a non-owner club role.
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
  return new;
end $$;

drop trigger auth_permissions_platform_audit on public.auth_permissions;
create trigger auth_permissions_platform_audit after insert or update or delete on public.auth_permissions
  for each row execute function club_private.platform_audit_row('key', 'kind', 'allowed_scopes', 'read_only', 'sensitive', 'non_delegable', 'description');

-- Super Admin only: can_platform() is Super Admin only today, and stage E must never give this to platform admins.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description)
values ('platform.permissions.manage', 'action', '{platform}', false, true, '修改默认权限、职位权限上限和个人权限');

-- 2. Layer tables. Fixed club roles only (no custom roles in V1). No client access; every change is in the platform log.
-- ② A row here means: this role can never have this permission, whatever any lower layer says.
create table public.auth_role_cap_blocks (
  role_key text not null references public.auth_roles(key) on delete cascade check (role_key in ('owner', 'admin')),
  permission_key text not null references public.auth_permissions(key) on delete restrict,
  primary key (role_key, permission_key)
);
-- ⑤ Per-club role default; no row = follow the platform default.
create table public.club_role_permissions (
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  role_key text not null references public.auth_roles(key) on delete cascade check (role_key in ('owner', 'admin')),
  permission_key text not null references public.auth_permissions(key) on delete restrict,
  allowed boolean not null,
  primary key (club_id, role_key, permission_key)
);
-- ③/④ Personal override; no row = follow the defaults. A Super Admin row wins over an owner row for the same permission;
-- owner rows apply only while the user is an admin. Rows outlive a role change but are always capped by the latest cap.
create table public.club_permission_overrides (
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  permission_key text not null references public.auth_permissions(key) on delete restrict,
  set_by text not null check (set_by in ('super_admin', 'owner')),
  allowed boolean not null,
  primary key (club_id, user_id, permission_key, set_by)
);
do $$
declare t text;
begin
  foreach t in array array['auth_role_cap_blocks', 'club_role_permissions', 'club_permission_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- Rows hold club-scope permissions only; a club default can never give a non-delegable permission to a non-owner role.
-- to_jsonb: one function for three tables without referencing a column another table lacks.
create function club_private.check_permission_layer() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(new); delegable boolean;
begin
  select not non_delegable into delegable from public.auth_permissions where key = r->>'permission_key' and 'club' = any(allowed_scopes);
  if not found then raise exception using errcode = '23514', message = '只能设置俱乐部范围的权限'; end if;
  if tg_table_name = 'club_role_permissions' and (r->>'allowed')::boolean and r->>'role_key' <> 'owner' and not delegable then
    raise exception using errcode = '23514', message = '此权限仅限公会长，不能授予其他职位';
  end if;
  return new;
end $$;
create trigger auth_role_cap_blocks_check before insert or update on public.auth_role_cap_blocks for each row execute function club_private.check_permission_layer();
create trigger club_role_permissions_check before insert or update on public.club_role_permissions for each row execute function club_private.check_permission_layer();
create trigger club_permission_overrides_check before insert or update on public.club_permission_overrides for each row execute function club_private.check_permission_layer();
create trigger auth_role_cap_blocks_platform_audit after insert or update or delete on public.auth_role_cap_blocks
  for each row execute function club_private.platform_audit_row('role_key', 'permission_key');
create trigger club_role_permissions_platform_audit after insert or update or delete on public.club_role_permissions
  for each row execute function club_private.platform_audit_row('club_id', 'role_key', 'permission_key', 'allowed');
create trigger club_permission_overrides_platform_audit after insert or update or delete on public.club_permission_overrides
  for each row execute function club_private.platform_audit_row('club_id', 'user_id', 'permission_key', 'set_by', 'allowed');
-- Same history protection as the other audit sources: a table wipe would erase layers without per-row log entries.
create trigger auth_role_cap_blocks_no_truncate before truncate on public.auth_role_cap_blocks for each statement execute function club_private.audit_immutable();
create trigger club_role_permissions_no_truncate before truncate on public.club_role_permissions for each statement execute function club_private.audit_immutable();
create trigger club_permission_overrides_no_truncate before truncate on public.club_permission_overrides for each statement execute function club_private.audit_immutable();

-- 3. The calculation. The deciding layer for one club role of one user; granted only when it ends in "_allow".
-- Every lookup is a primary-key probe. Invoker on purpose: callable only inside the definer functions below.
create function club_private.permission_layer(p_club uuid, p_user uuid, p_role text, p_permission text) returns text
language sql stable set search_path = '' as $$
  select case
    when p.key is null then 'unregistered'
    when p.non_delegable and p_role <> 'owner' then 'non_delegable'
    when exists(select 1 from public.auth_role_cap_blocks c where c.role_key = p_role and c.permission_key = p.key) then 'cap'
    when f.allowed then 'forced_allow' when not f.allowed then 'forced_deny'
    when o.allowed then 'owner_allow' when not o.allowed then 'owner_deny'
    when d.allowed then 'club_allow' when not d.allowed then 'club_deny'
    when exists(select 1 from public.auth_role_permissions rp where rp.role_key = p_role and rp.permission_key = p.key) then 'default_allow'
    else 'default_deny' end
  from (select) one
  left join public.auth_permissions p on p.key = p_permission and 'club' = any(p.allowed_scopes)
  left join public.club_permission_overrides f on f.club_id = p_club and f.user_id = p_user and f.permission_key = p_permission and f.set_by = 'super_admin'
  left join public.club_permission_overrides o on o.club_id = p_club and o.user_id = p_user and o.permission_key = p_permission and o.set_by = 'owner' and p_role = 'admin'
  left join public.club_role_permissions d on d.club_id = p_club and d.role_key = p_role and d.permission_key = p_permission;
$$;
create function club_private.layer_allows(p_layer text) returns boolean language sql immutable set search_path = '' as $$
  select p_layer in ('forced_allow', 'owner_allow', 'club_allow', 'default_allow');
$$;
revoke all on function club_private.permission_layer(uuid, uuid, text, text), club_private.layer_allows(text) from public, anon, authenticated, service_role;

-- Same as 20261030051258 except the membership branch asks permission_layer() instead of auth_role_permissions alone.
create or replace function club_private.can(p_club uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes))
    and exists(select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null)
    and (
      (club_private.super_admin_active() and exists(select 1 from public.club_clubs where id = p_club))
      -- Role scope and ownership are rechecked here too, not only by the membership trigger.
      or exists(select 1 from public.club_memberships m
                join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
                where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active'
                  and club_private.layer_allows(club_private.permission_layer(m.club_id, m.user_id, m.role, p_permission)))
    );
$$;
revoke all on function club_private.can(uuid, text) from public, anon, authenticated;

-- The platform user list shows the same calculation (identical to 20261031072234 otherwise).
create or replace function public.platform_users(p_query text default null, p_after_key text default null, p_after_id uuid default null) returns jsonb
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
        select m.club_id, c.name as club_name, array_agg(distinct p.key order by p.key) as permissions
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id
        join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
        join public.auth_permissions p on 'club' = any(p.allowed_scopes)
          and club_private.layer_allows(club_private.permission_layer(m.club_id, m.user_id, m.role, p.key))
        where m.user_id = v.id and m.status = 'active' and v.email_confirmed_at is not null
        group by m.club_id, c.name) e), '[]'::jsonb)
    ) order by v.k, v.id) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from matched) > 50 then (select jsonb_build_object('key', k, 'id', id) from visible order by k desc, id desc limit 1) end)
  into result;
  return result;
end $$;

-- 4. Super Admin settings. Writes need platform.permissions.manage and, checked separately, an active Super Admin.
-- Settings screen data: club-scope permissions, platform defaults, caps and (optionally) one club's defaults.
create function public.platform_permission_settings(p_club uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  if p_club is not null and not exists(select 1 from public.club_clubs where id = p_club) then
    raise exception using errcode = '22023', message = '目标俱乐部不存在';
  end if;
  return jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'description', description, 'sensitive', sensitive, 'non_delegable', non_delegable) order by key)
      from public.auth_permissions where 'club' = any(allowed_scopes)), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name) order by key = 'admin', key) from public.auth_roles where key in ('owner', 'admin')), '[]'::jsonb),
    'defaults', coalesce((select jsonb_agg(jsonb_build_object('role', rp.role_key, 'permission', rp.permission_key) order by rp.role_key, rp.permission_key)
      from public.auth_role_permissions rp where rp.role_key in ('owner', 'admin')), '[]'::jsonb),
    'cap_blocks', coalesce((select jsonb_agg(jsonb_build_object('role', role_key, 'permission', permission_key) order by role_key, permission_key) from public.auth_role_cap_blocks), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by created_at, id) from public.club_clubs), '[]'::jsonb),
    'club_id', p_club,
    'club_defaults', coalesce((select jsonb_agg(jsonb_build_object('role', role_key, 'permission', permission_key, 'allowed', allowed) order by role_key, permission_key)
      from public.club_role_permissions where club_id = p_club), '[]'::jsonb));
end $$;

-- p_layer: platform_default (p_value true/false), cap (true = within the cap), club_default (null = follow the platform).
create function public.platform_set_role_permission(p_layer text, p_role text, p_permission text, p_value boolean, p_club uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; n integer := 0;
begin
  if not club_private.can_platform('platform.permissions.manage') then raise exception using errcode = '42501', message = '只有超级管理员可以修改权限设置'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以修改权限设置'; end if;
  if p_layer is null or p_layer not in ('platform_default', 'cap', 'club_default') or p_role is null or p_role not in ('owner', 'admin')
    or (p_layer = 'club_default') <> (p_club is not null) or (p_value is null and p_layer <> 'club_default') then
    raise exception using errcode = '22023', message = '权限设置参数无效';
  end if;
  select * into perm from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes);
  if not found then raise exception using errcode = '22023', message = '权限不存在'; end if;
  if p_value and perm.non_delegable and p_role <> 'owner' then
    raise exception using errcode = 'PT409', message = '此权限仅限公会长，不能授予管理员（系统安全规则）';
  end if;
  if p_layer = 'platform_default' then
    if p_value then insert into public.auth_role_permissions(role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
    else delete from public.auth_role_permissions where role_key = p_role and permission_key = p_permission; end if;
  elsif p_layer = 'cap' then
    if p_value then delete from public.auth_role_cap_blocks where role_key = p_role and permission_key = p_permission;
    else insert into public.auth_role_cap_blocks(role_key, permission_key) values (p_role, p_permission) on conflict do nothing; end if;
  else
    -- Same club lock as role changes and business writers.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
    if not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
    if p_value is null then delete from public.club_role_permissions where club_id = p_club and role_key = p_role and permission_key = p_permission;
    else insert into public.club_role_permissions(club_id, role_key, permission_key, allowed) values (p_club, p_role, p_permission, p_value)
      on conflict (club_id, role_key, permission_key) do update set allowed = excluded.allowed where club_role_permissions.allowed is distinct from excluded.allowed; end if;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n > 0);
end $$;

-- Super Admin forced personal permission (set_by 'super_admin'). p_value null = follow the defaults again.
create function public.platform_set_personal_permission(p_club uuid, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; held text; n integer := 0;
begin
  if not club_private.can_platform('platform.permissions.manage') then raise exception using errcode = '42501', message = '只有超级管理员可以修改权限设置'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以修改权限设置'; end if;
  if p_club is null or p_user is null then raise exception using errcode = '22023', message = '权限设置参数无效'; end if;
  select * into perm from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes);
  if not found then raise exception using errcode = '22023', message = '权限不存在'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  if not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  if p_value is null then
    delete from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'super_admin';
  else
    select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active' for share;
    if held is null then raise exception using errcode = 'PT409', message = '该账户在此俱乐部没有职位，不能设置个人权限'; end if;
    if p_value and perm.non_delegable and held <> 'owner' then
      raise exception using errcode = 'PT409', message = '此权限仅限公会长，不能授予管理员（系统安全规则）';
    end if;
    insert into public.club_permission_overrides(club_id, user_id, permission_key, set_by, allowed) values (p_club, p_user, p_permission, 'super_admin', p_value)
      on conflict (club_id, user_id, permission_key, set_by) do update set allowed = excluded.allowed where club_permission_overrides.allowed is distinct from excluded.allowed;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n > 0);
end $$;

-- Why a user has (or lacks) each club permission in one club, for the settings screen. `allowed` is what can() grants
-- that user (tested for equality); the raw layer values let the UI say e.g. "单独允许，但超出上限，未生效".
create function public.platform_permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare held text; confirmed boolean;
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
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

revoke all on function club_private.check_permission_layer() from public, anon, authenticated, service_role;
revoke all on function public.platform_permission_settings(uuid), public.platform_set_role_permission(text, text, text, boolean, uuid),
  public.platform_set_personal_permission(uuid, uuid, text, boolean), public.platform_permission_explain(uuid, uuid) from public, anon, service_role;
grant execute on function public.platform_permission_settings(uuid), public.platform_set_role_permission(text, text, text, boolean, uuid),
  public.platform_set_personal_permission(uuid, uuid, text, boolean), public.platform_permission_explain(uuid, uuid) to authenticated;
