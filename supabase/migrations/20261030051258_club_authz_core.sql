-- P1 authorization core: permission registry, system roles, Super Admin identity and privacy-safe audit reads.
-- Additive. Existing write functions, business RLS and the Worker keep their owner/admin checks until P2.

create table public.auth_permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  kind text not null check (kind in ('action','field')),
  allowed_scopes text[] not null check (cardinality(allowed_scopes) > 0 and allowed_scopes <@ array['platform','alliance','club']),
  read_only boolean not null,
  sensitive boolean not null default false,
  description text not null check (length(btrim(description)) between 1 and 200),
  -- An alliance can never receive a write permission; writes must be granted per club.
  check (read_only or not 'alliance' = any(allowed_scopes))
);

create table public.auth_roles (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  scope_kind text not null check (scope_kind in ('platform','alliance','club')),
  -- Set only for a club's own custom role, which may then be assigned in that club alone.
  club_id uuid references public.club_clubs(id) on delete restrict,
  is_system boolean not null default false,
  name text not null check (length(btrim(name)) between 1 and 60),
  check (club_id is null or (scope_kind = 'club' and not is_system))
);

create table public.auth_role_permissions (
  role_key text not null references public.auth_roles(key) on delete cascade,
  permission_key text not null references public.auth_permissions(key) on delete restrict,
  primary key (role_key, permission_key)
);

-- Changed only by migration or SQL Editor: no role, override or API can grant or revoke this identity.
create table public.platform_super_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  public_name text not null default '超级管理员' check (length(btrim(public_name)) between 1 and 60 and public_name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['auth_permissions','auth_roles','auth_role_permissions','platform_super_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Identity and scope of registry entries never change in place; add a new entry instead.
create function club_private.registry_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare changed boolean;
begin
  -- Separate branches: PL/pgSQL resolves every field in an expression, even for the other table.
  if tg_table_name = 'auth_roles' then
    changed := (new.key, new.scope_kind, new.club_id, new.is_system) is distinct from (old.key, old.scope_kind, old.club_id, old.is_system);
  else
    changed := (new.key, new.kind, new.allowed_scopes, new.read_only) is distinct from (old.key, old.kind, old.allowed_scopes, old.read_only);
  end if;
  if changed then raise exception using errcode = '23514', message = '权限登记的标识和范围不可修改，请新增条目'; end if;
  return new;
end $$;
create trigger auth_roles_guard before update on public.auth_roles for each row execute function club_private.registry_guard();
create trigger auth_permissions_guard before update on public.auth_permissions for each row execute function club_private.registry_guard();

create function club_private.check_role_permission() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.auth_roles r join public.auth_permissions p on p.key = new.permission_key
                where r.key = new.role_key and r.scope_kind = any(p.allowed_scopes)) then
    raise exception using errcode = '23514', message = '此权限不能授予该范围的角色';
  end if;
  return new;
end $$;
create trigger auth_role_permission_scope before insert or update on public.auth_role_permissions
  for each row execute function club_private.check_role_permission();

create function club_private.check_club_role() returns trigger language plpgsql security definer set search_path = '' as $$
declare role_club uuid;
begin
  select club_id into role_club from public.auth_roles where key = new.role and scope_kind = 'club';
  if not found then raise exception using errcode = '23514', message = '不是俱乐部角色'; end if;
  if role_club is not null and role_club <> new.club_id then
    raise exception using errcode = '23514', message = '该角色属于其他俱乐部';
  end if;
  return new;
end $$;
create trigger club_membership_role_scope before insert or update of club_id, role on public.club_memberships
  for each row execute function club_private.check_club_role();

insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description) values
  ('members.read', 'action', '{platform,alliance,club}', true, false, '查看成员名单、个人档案、评分与分析'),
  ('imports.create', 'action', '{club}', false, false, '导入每日数据并更正昵称'),
  ('imports.delete', 'action', '{club}', false, false, '删除某日全部数据'),
  ('aliases.manage', 'action', '{club}', false, false, '记住或解除 AI 错名关联'),
  ('absences.resolve', 'action', '{club}', false, false, '处理待确认的缺席成员'),
  ('club.rename', 'action', '{club}', false, false, '修改俱乐部名称'),
  ('audit.read', 'action', '{platform,alliance,club}', true, true, '查看操作日志'),
  ('audit.actor_email.read', 'field', '{platform,alliance,club}', true, true, '在操作日志中查看操作者邮箱（超级管理员永远不显示）');
insert into public.auth_roles(key, scope_kind, is_system, name) values
  ('owner', 'club', true, '公会长'),
  ('admin', 'club', true, '管理员');
-- Same actions as today (rename stays owner-only). No system role sees actor emails by default.
insert into public.auth_role_permissions(role_key, permission_key) select 'owner', key from public.auth_permissions where kind = 'action';
insert into public.auth_role_permissions(role_key, permission_key) select 'admin', key from public.auth_permissions where kind = 'action' and key <> 'club.rename';

-- The legacy owner/admin check stays until P2 so the deployed Worker never meets an unknown role.
alter table public.club_memberships add constraint club_memberships_role_fkey foreign key (role) references public.auth_roles(key) on delete restrict;

insert into public.platform_super_admins(user_id) values ('d0ddb226-a10a-471c-be4b-d5e5153bd313');

-- Super Admin powers require MFA (aal2); without it the account keeps only its ordinary memberships.
create function club_private.super_admin_active() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal'), '') = 'aal2'
    and exists(select 1 from public.platform_super_admins s join auth.users u on u.id = s.user_id
               where s.user_id = (select auth.uid()) and u.email_confirmed_at is not null);
$$;

-- Default deny. Unregistered permissions are denied to everyone, including the Super Admin.
-- ponytail: no alliance scopes or overrides yet; P6/P7 extend this one function (deny first).
create function club_private.can(p_club uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes))
    and exists(select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null)
    and (
      (club_private.super_admin_active() and exists(select 1 from public.club_clubs where id = p_club))
      -- Role scope and ownership are rechecked here too, not only by the membership trigger.
      or exists(select 1 from public.club_memberships m
                join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
                join public.auth_role_permissions rp on rp.role_key = m.role
                where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission_key = p_permission)
    );
$$;

-- For RLS: `club_id in (select club_private.readable_clubs('members.read'))` runs once per statement.
create function club_private.readable_clubs(p_permission text) returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.club_clubs where club_private.can(id, p_permission);
$$;

-- For write functions: locks the caller's membership so a concurrent revocation cannot race the write.
create function club_private.require(p_club uuid, p_permission text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.club_memberships where club_id = p_club and user_id = (select auth.uid()) and status = 'active' for share;
  if not club_private.can(p_club, p_permission) then
    raise exception using errcode = '42501', message = '没有执行此操作的权限';
  end if;
end $$;

create function public.club_my_permissions(p_club uuid) returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(key order by key), '{}') from public.auth_permissions where club_private.can(p_club, key);
$$;

revoke all on function club_private.registry_guard() from public, anon, authenticated;
revoke all on function club_private.check_role_permission() from public, anon, authenticated;
revoke all on function club_private.check_club_role() from public, anon, authenticated;
-- Only the RLS helper and the Worker's permission read are callable by users; the rest run inside definer functions.
revoke all on function club_private.super_admin_active() from public, anon, authenticated;
revoke all on function club_private.can(uuid, text) from public, anon, authenticated;
revoke all on function club_private.require(uuid, text) from public, anon, authenticated;
revoke all on function club_private.readable_clubs(text) from public, anon;
revoke all on function public.club_my_permissions(uuid) from public, anon;
grant execute on function club_private.readable_clubs(text) to authenticated;
grant execute on function public.club_my_permissions(uuid) to authenticated;

-- Never store the Super Admin's email; callers cannot forge either marker. The real actor_id is always kept.
create or replace function club_private.audit_actor() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.platform_super_admins where user_id = new.actor_id) then
    new.details := (new.details - 'actor_email' - 'actor_kind') || jsonb_build_object('actor_kind', 'super_admin');
  else
    new.details := (new.details - 'actor_kind') || jsonb_build_object('actor_email', (select email from auth.users where id = new.actor_id));
  end if;
  -- One value even when a user later holds several roles in a club.
  new.details := new.details || jsonb_build_object('actor_role',
    (select role from public.club_memberships where club_id = new.club_id and user_id = new.actor_id order by role = 'owner' desc, role limit 1));
  return new;
end $$;

create function club_private.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = '审计记录不可修改或删除';
end $$;
revoke all on function club_private.audit_immutable() from public, anon, authenticated;
create trigger club_audit_immutable before update or delete on public.club_audit_events for each row execute function club_private.audit_immutable();
create trigger club_audit_no_truncate before truncate on public.club_audit_events for each statement execute function club_private.audit_immutable();

-- The audit table is read only through club_activity, which redacts per viewer.
revoke select on public.club_audit_events from authenticated;
-- Submitter/confirmer user IDs would identify the Super Admin despite masked logs; no reader uses them.
-- Column grants are default-deny: a future column stays hidden until it is granted here.
revoke select on public.club_imports, public.club_player_aliases from authenticated;
grant select (id, club_id, raw_text, schema_version, request_id, request_hash, created_at) on public.club_imports to authenticated;
grant select (id, club_id, player_id, alias_name, confirmed_at, revoked_at) on public.club_player_aliases to authenticated;

create or replace function public.club_activity(p_club_id uuid, p_before timestamptz default null, p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare full_view boolean; email_view boolean; result jsonb;
begin
  if not club_private.can(p_club_id, 'audit.read') then return jsonb_build_object('events', '[]'::jsonb, 'next', null); end if;
  full_view := club_private.super_admin_active();
  email_view := full_view or club_private.can(p_club_id, 'audit.actor_email.read');
  with page as (
    select id, actor_id, action, target_id, details, created_at from public.club_audit_events
    where club_id = p_club_id and (p_before is null or (created_at, id) < (p_before, p_id))
    order by created_at desc, id desc limit 51
  ), visible as (select * from page order by created_at desc, id desc limit 50),
  shaped as (
    -- Super Admin rows are judged by the current list, so historical rows that stored an email are redacted too.
    select v.id, v.created_at, jsonb_build_object(
      'id', v.id, 'action', v.action, 'target_id', v.target_id, 'created_at', v.created_at,
      'details', v.details - 'actor_email' - 'actor_kind',
      'actor_role', v.details->>'actor_role',
      'actor_kind', case when s.user_id is null then 'member' else 'super_admin' end,
      'actor_id', case when s.user_id is null or full_view then v.actor_id end,
      'actor_label', case when s.user_id is not null then
          case when full_view then (select u.email from auth.users u where u.id = v.actor_id) else s.public_name end
        when email_view then v.details->>'actor_email' end
    ) as event
    from visible v left join public.platform_super_admins s on s.user_id = v.actor_id
  )
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(event order by created_at desc, id desc) from shaped), '[]'::jsonb),
    'next', case when (select count(*) from page) > 50 then (select jsonb_build_object('before', created_at, 'id', id) from visible order by created_at, id limit 1) end)
  into result;
  return result;
end $$;
revoke all on function public.club_activity(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.club_activity(uuid, timestamptz, uuid) to authenticated;
