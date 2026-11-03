-- Permissions V1 stage F: alliances and alliance leaders. An alliance is a set of clubs (a club is in at most one).
-- Its leader reads the alliance's clubs through club_private.can() (read-only registered permissions only), decides
-- join requests, and has no other power. The Super Admin and platform admins manage alliances and leaders through
-- can_platform(); owners request to join. Additive: existing signatures are unchanged and the deployed Worker keeps working.

-- 1. Registry. Alliance-scope permissions stay read-only for club data; the one exception is alliance self-management
-- (`alliance.*`, alliance scope only), which can never reach can() because can() requires a club-scope permission.
alter table public.auth_permissions drop constraint auth_permissions_check;
alter table public.auth_permissions add constraint auth_permissions_alliance_read_only
  check (read_only or not 'alliance' = any(allowed_scopes) or (allowed_scopes = '{alliance}' and key like 'alliance.%'));
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, non_delegable, description) values
  ('alliance.joins.decide', 'action', '{alliance}', false, true, false, '批准或拒绝俱乐部加入本联盟'),
  ('club.alliance.request', 'action', '{club}', false, false, true, '申请加入联盟或撤回申请'),
  ('platform.alliances.manage', 'action', '{platform}', false, true, false, '新建、改名、停用联盟，并安排俱乐部所属联盟'),
  ('platform.alliance_leaders.assign', 'action', '{platform}', false, true, false, '任命或撤销联盟会长');
insert into public.auth_roles(key, scope_kind, is_system, name) values ('alliance_leader', 'alliance', true, '联盟会长');
-- Leaders read members/history/analytics and the club log of their alliance's clubs (no actor emails: that field
-- permission is not granted), and decide joins. Owners request joins; platform admins manage alliances and leaders.
insert into public.auth_role_permissions(role_key, permission_key) values
  ('alliance_leader', 'members.read'), ('alliance_leader', 'audit.read'), ('alliance_leader', 'alliance.joins.decide'),
  ('owner', 'club.alliance.request'),
  ('platform_admin', 'platform.alliances.manage'), ('platform_admin', 'platform.alliance_leaders.assign');

-- 2. Tables. History is kept (status); clients have no direct access; every change is platform-audited.
create table public.club_alliances (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);
create unique index club_alliances_name on public.club_alliances(lower(btrim(name)));
create table public.club_alliance_members (
  alliance_id uuid not null references public.club_alliances(id) on delete restrict,
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'left')),
  created_at timestamptz not null default now(),
  primary key (alliance_id, club_id)
);
create unique index club_one_alliance on public.club_alliance_members(club_id) where status = 'active';
create table public.alliance_leaders (
  alliance_id uuid not null references public.club_alliances(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (alliance_id, user_id)
);
create unique index alliance_one_leader on public.alliance_leaders(alliance_id) where status = 'active';
create unique index alliance_leader_one_alliance on public.alliance_leaders(user_id) where status = 'active';
create table public.club_alliance_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  alliance_id uuid not null references public.club_alliances(id) on delete restrict,
  -- closed: the platform placed the club directly, or the alliance was disabled, while the request was pending.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'closed')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index club_one_pending_alliance_request on public.club_alliance_requests(club_id) where status = 'pending';
do $$
declare t text;
begin
  foreach t in array array['club_alliances', 'club_alliance_members', 'alliance_leaders', 'club_alliance_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function club_private.audit_immutable()', t || '_no_truncate', t);
  end loop;
end $$;
create trigger club_alliances_platform_audit after insert or update or delete on public.club_alliances
  for each row execute function club_private.platform_audit_row('id', 'name', 'status');
create trigger club_alliance_members_platform_audit after insert or update or delete on public.club_alliance_members
  for each row execute function club_private.platform_audit_row('alliance_id', 'club_id', 'status');
create trigger alliance_leaders_platform_audit after insert or update or delete on public.alliance_leaders
  for each row execute function club_private.platform_audit_row('alliance_id', 'user_id', 'status');
-- Requester and decider ids are not logged (the event's actor already records who acted).
create trigger club_alliance_requests_platform_audit after insert or update or delete on public.club_alliance_requests
  for each row execute function club_private.platform_audit_row('id', 'club_id', 'alliance_id', 'status');

-- 3. Decisions. can() keeps every existing path (now club_private.can_direct) and adds one read-only alliance path:
-- an active leader of an active alliance, for a club that is an active member of it, for a registered read-only
-- permission that is both club- and alliance-scoped and granted to the alliance_leader role, unless the Super Admin
-- forced a deny of that permission for this user in this club (stage B personal setting, set_by = 'super_admin'): a
-- forced deny wins over every path except the active Super Admin's own. Writes need a non-read-only
-- permission, so no alliance path can ever satisfy club_private.require() for a write.
create function club_private.can_direct(p_club uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes))
    and exists(select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null)
    and (
      (club_private.super_admin_active() and exists(select 1 from public.club_clubs where id = p_club))
      or exists(select 1 from public.club_memberships m
                join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
                where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active'
                  and club_private.layer_allows(club_private.permission_layer(m.club_id, m.user_id, m.role, p_permission)))
    );
$$;
create function club_private.can_alliance_read(p_club uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions p where p.key = p_permission and p.read_only
      and 'club' = any(p.allowed_scopes) and 'alliance' = any(p.allowed_scopes))
    and exists(select 1 from public.alliance_leaders l
      join public.club_alliances a on a.id = l.alliance_id and a.status = 'active'
      join public.club_alliance_members m on m.alliance_id = a.id and m.club_id = p_club and m.status = 'active'
      join auth.users u on u.id = l.user_id and u.email_confirmed_at is not null
      join public.auth_role_permissions rp on rp.role_key = 'alliance_leader' and rp.permission_key = p_permission
      where l.user_id = (select auth.uid()) and l.status = 'active')
    and not exists(select 1 from public.club_permission_overrides o where o.club_id = p_club and o.user_id = (select auth.uid())
      and o.permission_key = p_permission and o.set_by = 'super_admin' and not o.allowed);
$$;
create or replace function club_private.can(p_club uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select club_private.can_direct(p_club, p_permission) or club_private.can_alliance_read(p_club, p_permission);
$$;
-- The alliance decision point (like can_platform): the active leader of this active alliance, for an alliance-scope
-- permission granted to the role.
create function club_private.can_alliance(p_alliance uuid, p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and allowed_scopes = '{alliance}')
    and exists(select 1 from public.alliance_leaders l
      join public.club_alliances a on a.id = l.alliance_id and a.status = 'active'
      join auth.users u on u.id = l.user_id and u.email_confirmed_at is not null
      join public.auth_role_permissions rp on rp.role_key = 'alliance_leader' and rp.permission_key = p_permission
      where l.alliance_id = p_alliance and l.user_id = (select auth.uid()) and l.status = 'active');
$$;
-- For RLS where alliance access must not apply (raw import JSON stays with the club's own readers).
create function club_private.readable_clubs_direct(p_permission text) returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.club_clubs where club_private.can_direct(id, p_permission);
$$;
revoke all on function club_private.can_direct(uuid, text), club_private.can_alliance_read(uuid, text), club_private.can_alliance(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function club_private.readable_clubs_direct(text) from public, anon;
grant execute on function club_private.readable_clubs_direct(text) to authenticated;
create policy import_direct_readers on public.club_imports as restrictive for select to authenticated
  using (club_id in (select club_private.readable_clubs_direct('members.read')));

-- 4. Leader reader and decision.
create function public.club_my_alliance() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.club_alliances%rowtype;
begin
  select x.* into a from public.alliance_leaders l join public.club_alliances x on x.id = l.alliance_id and x.status = 'active'
    join auth.users u on u.id = l.user_id and u.email_confirmed_at is not null
    where l.user_id = (select auth.uid()) and l.status = 'active';
  if not found then return jsonb_build_object('alliance', null, 'clubs', '[]'::jsonb, 'requests', '[]'::jsonb); end if;
  return jsonb_build_object('alliance', jsonb_build_object('id', a.id, 'name', a.name),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name, c.id)
      from public.club_alliance_members m join public.club_clubs c on c.id = m.club_id where m.alliance_id = a.id and m.status = 'active'), '[]'::jsonb),
    'requests', case when club_private.can_alliance(a.id, 'alliance.joins.decide') then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'club_id', r.club_id, 'club_name', c.name, 'created_at', r.created_at) order by r.created_at, r.id)
      from public.club_alliance_requests r join public.club_clubs c on c.id = r.club_id where r.alliance_id = a.id and r.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create function public.alliance_decide_request(p_request uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.club_alliance_requests%rowtype;
begin
  if p_request is null or p_decision is null or p_decision not in ('approve', 'reject') then raise exception using errcode = '22023', message = '申请处理参数无效'; end if;
  select * into r from public.club_alliance_requests where id = p_request;
  -- The same answer for an unknown request and another alliance's request.
  if not found or not club_private.can_alliance(r.alliance_id, 'alliance.joins.decide') then raise exception using errcode = '42501', message = '没有处理这个申请的权限'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance-club:' || r.club_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance:' || r.alliance_id::text, 0));
  select * into r from public.club_alliance_requests where id = p_request for update;
  if r.status <> 'pending' then raise exception using errcode = 'PT409', message = '这个申请已经处理过了，请刷新'; end if;
  if not club_private.can_alliance(r.alliance_id, 'alliance.joins.decide') then raise exception using errcode = '42501', message = '没有处理这个申请的权限'; end if;
  if p_decision = 'approve' then
    if exists(select 1 from public.club_alliance_members where club_id = r.club_id and status = 'active') then
      raise exception using errcode = 'PT409', message = '该俱乐部已属于一个联盟';
    end if;
    insert into public.club_alliance_members(alliance_id, club_id) values (r.alliance_id, r.club_id)
      on conflict (alliance_id, club_id) do update set status = 'active';
  end if;
  update public.club_alliance_requests set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
    decided_by = (select auth.uid()), decided_at = now() where id = p_request;
  insert into public.club_audit_events(club_id, actor_id, action, details) values (r.club_id, (select auth.uid()),
    case p_decision when 'approve' then 'alliance_joined' else 'alliance_request_rejected' end, jsonb_build_object('alliance', (select name from public.club_alliances where id = r.alliance_id)));
  return jsonb_build_object('changed', true);
end $$;

-- 5. Owner: status, request, withdraw (club.alliance.request, owner only, non-delegable).
create function public.club_alliance_status(p_club uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'club.alliance.request') then raise exception using errcode = '42501', message = '没有管理本俱乐部联盟的权限'; end if;
  return jsonb_build_object(
    'alliance', (select jsonb_build_object('id', a.id, 'name', a.name) from public.club_alliance_members m join public.club_alliances a on a.id = m.alliance_id
      where m.club_id = p_club and m.status = 'active'),
    'request', (select jsonb_build_object('id', r.id, 'alliance_id', r.alliance_id, 'alliance_name', a.name, 'created_at', r.created_at)
      from public.club_alliance_requests r join public.club_alliances a on a.id = r.alliance_id where r.club_id = p_club and r.status = 'pending'),
    'alliances', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id) from public.club_alliances where status = 'active'), '[]'::jsonb));
end $$;
create function public.club_request_alliance(p_club uuid, p_alliance uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance-club:' || p_club::text, 0));
  perform club_private.require(p_club, 'club.alliance.request');
  if p_alliance is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance:' || p_alliance::text, 0)); end if;
  if p_alliance is null or not exists(select 1 from public.club_alliances where id = p_alliance and status = 'active') then raise exception using errcode = '22023', message = '联盟不存在或已停用'; end if;
  if exists(select 1 from public.club_alliance_members where club_id = p_club and status = 'active') then raise exception using errcode = 'PT409', message = '本俱乐部已属于一个联盟'; end if;
  if exists(select 1 from public.club_alliance_requests where club_id = p_club and status = 'pending') then raise exception using errcode = 'PT409', message = '已有待处理的申请，请先撤回'; end if;
  insert into public.club_alliance_requests(club_id, alliance_id, requested_by) values (p_club, p_alliance, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, details) values (p_club, (select auth.uid()), 'alliance_requested', jsonb_build_object('alliance', (select name from public.club_alliances where id = p_alliance)));
  return jsonb_build_object('changed', true);
end $$;
create function public.club_withdraw_alliance_request(p_club uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance-club:' || p_club::text, 0));
  perform club_private.require(p_club, 'club.alliance.request');
  update public.club_alliance_requests set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = now() where club_id = p_club and status = 'pending';
  get diagnostics n = row_count;
  if n > 0 then insert into public.club_audit_events(club_id, actor_id, action, details) values (p_club, (select auth.uid()), 'alliance_request_withdrawn', '{}'::jsonb); end if;
  return jsonb_build_object('changed', n > 0);
end $$;

-- 6. Platform: read, create/rename/disable, place a club, appoint/revoke leaders.
create function public.platform_alliances() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
  return jsonb_build_object(
    'alliances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'created_at', a.created_at,
        'leader', (select jsonb_build_object('user_id', l.user_id, 'email', u.email) from public.alliance_leaders l join auth.users u on u.id = l.user_id
          where l.alliance_id = a.id and l.status = 'active'),
        'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name, c.id) from public.club_alliance_members m
          join public.club_clubs c on c.id = m.club_id where m.alliance_id = a.id and m.status = 'active'), '[]'::jsonb),
        'pending', (select count(*) from public.club_alliance_requests r where r.alliance_id = a.id and r.status = 'pending'))
      order by a.name, a.id) from public.club_alliances a), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'alliance_id', (select m.alliance_id from public.club_alliance_members m where m.club_id = c.id and m.status = 'active')) order by c.name, c.id)
      from public.club_clubs c), '[]'::jsonb));
end $$;
create function public.platform_save_alliance(p_alliance uuid, p_name text, p_status text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare id uuid := p_alliance; n text := btrim(coalesce(p_name, ''));
begin
  if not club_private.can_platform('platform.alliances.manage') then raise exception using errcode = '42501', message = '需要联盟管理权限，并在本次登录完成两步验证'; end if;
  if length(n) not between 1 and 60 or n ~ '[[:cntrl:]]' or p_status is null or p_status not in ('active', 'disabled') then raise exception using errcode = '22023', message = '联盟名称须为 1 到 60 个字'; end if;
  if exists(select 1 from public.club_alliances where lower(btrim(name)) = lower(n) and (p_alliance is null or club_alliances.id <> p_alliance)) then raise exception using errcode = 'PT409', message = '已有同名联盟'; end if;
  if p_alliance is null then
    begin insert into public.club_alliances(name, status) values (n, p_status) returning club_alliances.id into id;
    exception when unique_violation then raise exception using errcode = 'PT409', message = '已有同名联盟'; end;
  else
    -- Same lock as requests and decisions, so none can slip in while the alliance is being disabled.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance:' || p_alliance::text, 0));
    begin update public.club_alliances set name = n, status = p_status where club_alliances.id = p_alliance and (name, status) is distinct from (n, p_status);
    exception when unique_violation then raise exception using errcode = 'PT409', message = '已有同名联盟'; end;
    if not exists(select 1 from public.club_alliances where club_alliances.id = p_alliance) then raise exception using errcode = '22023', message = '联盟不存在'; end if;
    -- A disabled alliance gives no access; its pending requests are closed (can be requested again once re-enabled).
    if p_status = 'disabled' then update public.club_alliance_requests set status = 'closed', decided_by = (select auth.uid()), decided_at = now() where alliance_id = p_alliance and status = 'pending'; end if;
  end if;
  return jsonb_build_object('id', id);
end $$;
create function public.platform_set_club_alliance(p_club uuid, p_alliance uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current uuid;
begin
  if not club_private.can_platform('platform.alliances.manage') then raise exception using errcode = '42501', message = '需要联盟管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance-club:' || p_club::text, 0));
  if p_alliance is not null and not exists(select 1 from public.club_alliances where id = p_alliance and status = 'active') then raise exception using errcode = '22023', message = '联盟不存在或已停用'; end if;
  select alliance_id into current from public.club_alliance_members where club_id = p_club and status = 'active';
  if current is not distinct from p_alliance then return jsonb_build_object('changed', false); end if;
  update public.club_alliance_members set status = 'left' where club_id = p_club and status = 'active';
  if p_alliance is not null then
    insert into public.club_alliance_members(alliance_id, club_id) values (p_alliance, p_club) on conflict (alliance_id, club_id) do update set status = 'active';
  end if;
  update public.club_alliance_requests set status = 'closed', decided_by = (select auth.uid()), decided_at = now() where club_id = p_club and status = 'pending';
  return jsonb_build_object('changed', true);
end $$;
create function public.platform_set_alliance_leader(p_alliance uuid, p_email text, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target uuid; held uuid;
begin
  if not club_private.can_platform('platform.alliance_leaders.assign') then raise exception using errcode = '42501', message = '需要联盟会长任命权限，并在本次登录完成两步验证'; end if;
  if p_alliance is null or p_action is null or p_action not in ('grant', 'revoke') then raise exception using errcode = '22023', message = '会长操作参数无效'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance:' || p_alliance::text, 0));
  if not exists(select 1 from public.club_alliances where id = p_alliance) then raise exception using errcode = '22023', message = '联盟不存在'; end if;
  select user_id into held from public.alliance_leaders where alliance_id = p_alliance and status = 'active';
  if p_action = 'revoke' then
    if held is null then return jsonb_build_object('changed', false); end if;
    if held = (select auth.uid()) and not club_private.super_admin_active() then raise exception using errcode = '42501', message = '不能修改自己的职位'; end if;
    update public.alliance_leaders set status = 'revoked' where alliance_id = p_alliance and user_id = held;
    return jsonb_build_object('changed', true);
  end if;
  if not exists(select 1 from public.club_alliances where id = p_alliance and status = 'active') then raise exception using errcode = 'PT409', message = '联盟已停用'; end if;
  select id into target from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) and email_confirmed_at is not null order by id limit 1;
  if target is null then raise exception using errcode = '22023', message = '找不到可任命的账户：请确认对方已注册网站账户并完成邮箱验证'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alliance-leader:' || target::text, 0));
  if target = (select auth.uid()) and not club_private.super_admin_active() then raise exception using errcode = '42501', message = '不能修改自己的职位'; end if;
  if held = target then return jsonb_build_object('changed', false); end if;
  if held is not null then raise exception using errcode = 'PT409', message = '该联盟已有会长，请先撤销'; end if;
  if exists(select 1 from public.alliance_leaders where user_id = target and status = 'active') then raise exception using errcode = 'PT409', message = '该账户已是其他联盟的会长'; end if;
  insert into public.alliance_leaders(alliance_id, user_id) values (p_alliance, target) on conflict (alliance_id, user_id) do update set status = 'active';
  return jsonb_build_object('changed', true);
end $$;

-- Same as 20261101191854 except `alliances` is the real number of active alliances.
create or replace function public.platform_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要超级管理员权限'; end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'clubs', (select count(*) from public.club_clubs),
      'users', (select count(*) from auth.users),
      'confirmed_users', (select count(*) from auth.users where email_confirmed_at is not null),
      'members', (select count(distinct user_id) from public.club_memberships where status = 'active'),
      'active_roles', (select count(*) from public.club_memberships where status = 'active')),
    'alliances', (select count(*) from public.club_alliances where status = 'active'),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'created_at', c.created_at,
        'members', (select count(distinct m.user_id) from public.club_memberships m where m.club_id = c.id and m.status = 'active'),
        'admins', (select count(*) from public.club_memberships m where m.club_id = c.id and m.role = 'admin' and m.status = 'active'),
        'admin_limit', c.admin_limit,
        'players', history.total,
        'latest_snapshot', latest.snapshot_date,
        'is_complete_roster', latest.is_complete_roster,
        'player_counts', case when latest.id is null then null else counts.data end
      ) order by c.created_at, c.id)
      from public.club_clubs c
      cross join lateral (select count(*) as total from public.club_players p where p.club_id=c.id) history
      left join lateral (
        select s.id,s.snapshot_date,s.is_complete_roster from public.club_snapshots s
        where s.club_id=c.id and s.is_current and s.deleted_at is null order by s.snapshot_date desc limit 1
      ) latest on true
      left join lateral (
        select public.club_roster_presence(c.id,latest.id) as data where latest.id is not null
      ) roster on true
      cross join lateral (
        select jsonb_build_object(
          'present', count(*) filter (where r->>'presence'='present'),
          'temporary', count(*) filter (where r->>'presence'='left' and r->>'absence_decision'='temporary'),
          'confirmed_left', count(*) filter (where r->>'presence'='left' and r->>'absence_decision'='left'),
          -- Identities with only removed/superseded observations remain unknown, never inferred departures.
          'unconfirmed', history.total-count(*) + count(*) filter (where r->>'presence'='unconfirmed'),
          'other_left', count(*) filter (where r->>'presence'='left' and coalesce(r->>'absence_decision','') not in ('temporary','left'))
        ) as data from jsonb_array_elements(roster.data->'members') r
      ) counts
    ), '[]'::jsonb));
end $$;

-- 7. The caller's own state for the Worker: `alliance_leader` (an active leader of an active alliance) lets the account
-- sign in and reach the alliance workspace without any club role. Otherwise identical to 20261101235927.
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
    'alliance_leader', exists(select 1 from public.alliance_leaders l join public.club_alliances a on a.id = l.alliance_id and a.status = 'active'
      join auth.users u on u.id = l.user_id and u.email_confirmed_at is not null where l.user_id = (select auth.uid()) and l.status = 'active'),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2',
    'platform_permissions', coalesce((select jsonb_agg(key order by key) from public.auth_permissions
      where 'platform' = any(allowed_scopes) and club_private.can_platform(key)), '[]'::jsonb));
$$;

do $$
declare f text;
begin
  foreach f in array array['public.club_my_alliance()', 'public.alliance_decide_request(uuid,text)', 'public.club_alliance_status(uuid)',
    'public.club_request_alliance(uuid,uuid)', 'public.club_withdraw_alliance_request(uuid)', 'public.platform_alliances()',
    'public.platform_save_alliance(uuid,text,text)', 'public.platform_set_club_alliance(uuid,uuid)', 'public.platform_set_alliance_leader(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 8. Review fix: platform log masking (see the comment on the function).
-- Same as 20261101235927 (stage E masking), and in addition, for viewers other than the active Super Admin, an event
-- made by a Super Admin shows no club and keeps no identifier in its details (club_id, alliance_id, id, ...): its time
-- and action alone. Otherwise the club or alliance it touched could be matched to the account that leads or owns it
-- (an alliance leader's join decisions, or an owner's own club changes). Original text of stage E follows:
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
          else coalesce((select jsonb_object_agg(k, case when jsonb_typeof(x) = 'object' then x - 'user_id' - 'created_at' - 'club_id' - 'alliance_id' - 'id' - 'factor_id' else x end) from jsonb_each(v.details) d(k, x)), '{}'::jsonb) end,
        'actor', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then (select u.email from auth.users u where u.id = v.actor_id) end,
        'actor_kind', case when exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then 'super_admin' end,
        'subject', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then
          (select u.email from auth.users u where u.id = coalesce(v.details#>>'{new,user_id}', v.details#>>'{old,user_id}')::uuid) end,
        'club', case when sees or not exists(select 1 from public.platform_super_admins s where s.user_id = v.actor_id) then
          (select c.name from public.club_clubs c where c.id = coalesce(v.details#>>'{new,club_id}', v.details#>>'{old,club_id}')::uuid) end
      ) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from page) > 50 then (select jsonb_build_object('before', created_at, 'id', id) from visible order by created_at, id limit 1) end)
  into result;
  return result;
end $$;

-- 9. The Super Admin's forced deny also covers alliance reads. Same as 20261101195800 except a deny may be set for an
-- active leader of this club's alliance who has no club role here.
create or replace function public.platform_set_personal_permission(p_club uuid, p_user uuid, p_permission text, p_value boolean) returns jsonb
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
    -- Stage F: a leader whose alliance contains this club reads it without a club role; the Super Admin may forbid
    -- such a read here (a deny only).
    if held is null and not (p_value = false and exists(select 1 from public.alliance_leaders l
        join public.club_alliance_members m on m.alliance_id = l.alliance_id and m.club_id = p_club and m.status = 'active'
        where l.user_id = p_user and l.status = 'active')) then
      raise exception using errcode = 'PT409', message = '该账户在此俱乐部没有职位，不能设置个人权限';
    end if;
    if p_value and perm.non_delegable and held <> 'owner' then
      raise exception using errcode = 'PT409', message = '此权限仅限公会长，不能授予管理员（系统安全规则）';
    end if;
    insert into public.club_permission_overrides(club_id, user_id, permission_key, set_by, allowed) values (p_club, p_user, p_permission, 'super_admin', p_value)
      on conflict (club_id, user_id, permission_key, set_by) do update set allowed = excluded.allowed where club_permission_overrides.allowed is distinct from excluded.allowed;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n > 0);
end $$;

