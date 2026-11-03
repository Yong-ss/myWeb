-- Permissions V1 stage A: one active role per user per club, explicit owner transfer, remove from a club,
-- and a Super Admin-only admin limit. Supersedes D-036 (role union).
-- Compatible with the deployed Worker: platform_assign_role keeps its signature and, for transfer, its previous
-- behaviour (the previous owner leaves). New callers use platform_transfer_owner / platform_remove_from_club.

-- 1. Existing double roles: keep the owner, revoke the extra role (row and history kept; the platform audit
-- trigger records each change with via = the migration login).
update public.club_memberships m set status = 'revoked'
where m.status = 'active' and m.role <> 'owner'
  and exists(select 1 from public.club_memberships o where o.club_id = m.club_id and o.user_id = m.user_id and o.role = 'owner' and o.status = 'active');
-- Any other double role has no confirmed rule: stop the migration (whole file rolls back) instead of guessing.
do $$ begin
  if exists(select 1 from public.club_memberships where status = 'active' group by club_id, user_id having count(*) > 1) then
    raise exception 'Single-role migration stopped: a user holds several non-owner active roles in one club; decide which to keep first';
  end if;
end $$;
-- 2. The rule itself. The primary key (club_id, user_id, role) stays, so revoked rows keep their history.
create unique index club_one_active_role on public.club_memberships(club_id, user_id) where status = 'active';

insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description)
values ('platform.clubs.admin_limit', 'action', '{platform}', false, true, '修改俱乐部管理员人数上限');

-- The actor_role in club audit is the actor's current role, not an old revoked one.
create or replace function club_private.audit_actor() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.platform_super_admins where user_id = new.actor_id) then
    new.details := (new.details - 'actor_email' - 'actor_kind') || jsonb_build_object('actor_kind', 'super_admin');
  else
    new.details := (new.details - 'actor_kind') || jsonb_build_object('actor_email', (select email from auth.users where id = new.actor_id));
  end if;
  new.details := new.details || jsonb_build_object('actor_role',
    (select role from public.club_memberships where club_id = new.club_id and user_id = new.actor_id order by status = 'active' desc, role = 'owner' desc, role limit 1));
  return new;
end $$;

-- Role management is Super Admin only for now (stage E adds platform admins here, and only here).
create function club_private.require_role_manager() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要超级管理员角色管理权限'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '需要已确认设备的两步验证会话'; end if;
end $$;

-- One transaction for every club role change. p_action: grant | revoke | transfer | remove.
-- Transfer: p_previous = 'admin' (previous owner stays as admin) or 'leave'; null only for the legacy caller (= leave).
create function club_private.change_role(p_club uuid, p_user uuid, p_role text, p_action text, p_previous text, p_expected bigint, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); club public.club_clubs%rowtype; saved club_private.role_requests%rowtype;
  -- Same payload shape as before for grant/revoke/legacy transfer, so pre-migration request IDs still replay.
  payload jsonb := jsonb_build_object('club', p_club, 'user', p_user, 'role', p_role, 'action', p_action, 'expected', p_expected)
    || case when p_previous is null then '{}'::jsonb else jsonb_build_object('previous', p_previous) end;
  held text; held_name text; owner_id uuid; changed boolean := false; response jsonb;
begin
  perform club_private.require_role_manager();
  if p_club is null or p_user is null or p_request is null or p_expected is null or p_expected < 0
    or p_action is null or p_action not in ('grant', 'revoke', 'transfer', 'remove')
    or (p_action = 'remove') <> (p_role is null) or (p_role is not null and p_role not in ('owner', 'admin'))
    or (p_action = 'transfer' and p_role <> 'owner')
    or (p_previous is not null and (p_action <> 'transfer' or p_previous not in ('admin', 'leave'))) then
    raise exception using errcode = '22023', message = '角色操作参数无效';
  end if;
  -- Request lock prevents cross-club reuse racing the same actor/request key; the club lock matches business writers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_request::text, 1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  -- A queued request must observe device/session revocation that happened while waiting for either lock.
  perform club_private.require_role_manager();
  select * into saved from club_private.role_requests where actor_id = actor and request_id = p_request;
  if found then
    if saved.payload <> payload then raise exception using errcode = 'PT409', message = '提交编号已用于其他角色操作'; end if;
    return saved.result;
  end if;
  select * into club from public.club_clubs where id = p_club for update;
  if not found then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  if club.role_version <> p_expected then raise exception using errcode = 'PT409', message = '角色已被修改，请刷新后重试'; end if;
  perform 1 from auth.users where id = p_user and (p_action in ('revoke', 'remove') or email_confirmed_at is not null) for share;
  if not found then raise exception using errcode = '22023', message = '目标账户不存在或邮箱尚未验证'; end if;
  -- Row locks above may also wait (for example a concurrent account update). Recheck before any mutation.
  perform club_private.require_role_manager();
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
      -- The legacy caller treated this as a no-op; the new transfer refuses it explicitly.
      if p_previous is not null then raise exception using errcode = 'PT409', message = '该账户已是此俱乐部的公会长'; end if;
    else
      -- The successor's current role (e.g. admin) is released first, so they end with exactly one role.
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = p_user and status = 'active';
      update public.club_memberships set status = 'revoked' where club_id = p_club and user_id = owner_id and role = 'owner';
      if p_previous = 'admin' then
        -- Counted after the successor's admin slot is released; exceeding the limit aborts the whole transfer.
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
  end if;
  response := jsonb_build_object('changed', changed, 'role_version', (select role_version from public.club_clubs where id = p_club));
  insert into club_private.role_requests(actor_id, request_id, payload, result) values (actor, p_request, payload, response);
  return response;
end $$;

-- Deployed Worker's entry point (unchanged signature). Single-role rule applies; transfer = previous owner leaves.
create or replace function public.platform_assign_role(p_club uuid, p_user uuid, p_role text, p_action text, p_expected bigint, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要超级管理员角色管理权限'; end if;
  perform club_private.require_role_manager();
  if p_action is null or p_action not in ('grant', 'revoke', 'transfer') or p_role is null then
    raise exception using errcode = '22023', message = '角色操作参数无效';
  end if;
  return club_private.change_role(p_club, p_user, p_role, p_action, null, p_expected, p_request);
end $$;

-- p_previous_owner has no default: the caller must choose 'admin' (stays as admin) or 'leave' (removed from the club).
create function public.platform_transfer_owner(p_club uuid, p_user uuid, p_previous_owner text, p_expected bigint, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要超级管理员角色管理权限'; end if;
  perform club_private.require_role_manager();
  if p_previous_owner is null or p_previous_owner not in ('admin', 'leave') then
    raise exception using errcode = '22023', message = '请选择原公会长的去留';
  end if;
  return club_private.change_role(p_club, p_user, 'owner', 'transfer', p_previous_owner, p_expected, p_request);
end $$;

-- Revokes every active role of the user in this one club only; other clubs and platform identities are untouched.
create function public.platform_remove_from_club(p_club uuid, p_user uuid, p_expected bigint, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要超级管理员角色管理权限'; end if;
  return club_private.change_role(p_club, p_user, null, 'remove', null, p_expected, p_request);
end $$;

-- Super Admin only (platform.clubs.admin_limit is never given to other platform roles). Never removes anyone:
-- a limit below the current number of active admins is refused.
create function public.platform_set_admin_limit(p_club uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare club public.club_clubs%rowtype; admins bigint;
begin
  if not club_private.can_platform('platform.clubs.admin_limit') then raise exception using errcode = '42501', message = '只有超级管理员可以修改管理员人数上限'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以修改管理员人数上限'; end if;
  if p_club is null or p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = '管理员人数上限须为 1 到 1000 之间的整数';
  end if;
  -- Same club lock as role changes, so a concurrent appointment cannot slip past a lowered limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  select * into club from public.club_clubs where id = p_club for update;
  if not found then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  if not club_private.can_platform('platform.clubs.admin_limit') then raise exception using errcode = '42501', message = '只有超级管理员可以修改管理员人数上限'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以修改管理员人数上限'; end if;
  select count(*) into admins from public.club_memberships where club_id = p_club and role = 'admin' and status = 'active';
  if p_limit < admins then
    raise exception using errcode = 'PT409', message = format('该俱乐部目前有 %s 名有效管理员，上限不能低于此数。请先撤销多余的管理员。', admins);
  end if;
  if p_limit <> club.admin_limit then update public.club_clubs set admin_limit = p_limit where id = p_club; end if;
  return jsonb_build_object('changed', p_limit <> club.admin_limit, 'admin_limit', p_limit, 'admins', admins);
end $$;

-- Limit changes are audited however they are made (including SQL Editor).
create function club_private.admin_limit_audit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.admin_limit is distinct from old.admin_limit then
    insert into public.platform_audit_events(actor_id, action, details) values ((select auth.uid()), 'club_clubs.admin_limit',
      jsonb_build_object('old', jsonb_build_object('club_id', old.id, 'admin_limit', old.admin_limit), 'new', jsonb_build_object('club_id', new.id, 'admin_limit', new.admin_limit)));
  end if;
  return null;
end $$;
create trigger club_clubs_admin_limit_audit after update of admin_limit on public.club_clubs for each row execute function club_private.admin_limit_audit();

-- Context for the role dialog gains the current number of active admins per club (additive field).
create or replace function public.platform_role_context(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.roles.assign') then raise exception using errcode = '42501', message = '需要超级管理员角色管理权限'; end if;
  perform club_private.require_role_manager();
  if not exists(select 1 from auth.users where id = p_user) then
    raise exception using errcode = '22023', message = '目标账户不存在';
  end if;
  return jsonb_build_object(
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'admin_limit', c.admin_limit, 'role_version', c.role_version,
      'owner_id', (select user_id from public.club_memberships where club_id = c.id and role = 'owner' and status = 'active'),
      'admins', (select count(*) from public.club_memberships where club_id = c.id and role = 'admin' and status = 'active')) order by c.created_at, c.id) from public.club_clubs c), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('club_id', club_id, 'role', role, 'status', status) order by club_id, role) from public.club_memberships where user_id = p_user), '[]'::jsonb));
end $$;

-- Overview rows gain admin limit and active admin count (additive fields; otherwise identical to 20261031111245).
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
    'alliances', null,
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

revoke all on function club_private.require_role_manager() from public, anon, authenticated, service_role;
revoke all on function club_private.change_role(uuid, uuid, text, text, text, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function club_private.admin_limit_audit() from public, anon, authenticated, service_role;
revoke all on function public.platform_transfer_owner(uuid, uuid, text, bigint, uuid), public.platform_remove_from_club(uuid, uuid, bigint, uuid),
  public.platform_set_admin_limit(uuid, integer) from public, anon, service_role;
grant execute on function public.platform_transfer_owner(uuid, uuid, text, bigint, uuid), public.platform_remove_from_club(uuid, uuid, bigint, uuid),
  public.platform_set_admin_limit(uuid, integer) to authenticated;
