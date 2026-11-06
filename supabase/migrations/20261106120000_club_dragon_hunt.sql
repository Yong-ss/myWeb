-- Dragon Hunt V1. Additive, on the shared club_events lifecycle like the Highland Race: attendance only (no metrics,
-- no score), at most one valid hunt per club and day, its own three permissions (independent of events.* and
-- highland.*) and a platform permission to set them per club. No corrections: a wrong import is voided and imported
-- again. Every name in the screenshot is a member of this club; names that match nobody are left out by the page
-- and only their count is logged.

-- 1. Registry. Same defaults as the other event types.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description) values
  ('dragon.read', 'action', '{alliance,club}', true, false, '查看猎龙出勤'),
  ('dragon.import', 'action', '{club}', false, false, '导入猎龙出勤'),
  ('dragon.edit', 'action', '{club}', false, false, '作废猎龙记录'),
  ('platform.dragon.permissions', 'action', '{platform}', false, true, '按俱乐部设置公会长和管理员的猎龙权限');
insert into public.auth_role_permissions(role_key, permission_key) values
  ('owner', 'dragon.read'), ('owner', 'dragon.import'), ('owner', 'dragon.edit'),
  ('admin', 'dragon.read'), ('admin', 'dragon.import'), ('admin', 'dragon.edit'),
  ('alliance_leader', 'dragon.read'), ('platform_admin', 'platform.dragon.permissions');

-- 2. The platform-admin layer may also hold the three dragon permissions.
alter table public.club_permission_overrides drop constraint club_permission_overrides_platform_events;
alter table public.club_permission_overrides add constraint club_permission_overrides_platform_events
  check (set_by <> 'platform' or permission_key in ('events.read', 'events.import', 'events.edit', 'highland.read', 'highland.import', 'highland.edit', 'dragon.read', 'dragon.import', 'dragon.edit'));
alter table public.club_platform_role_permissions drop constraint club_platform_role_permissions_permission_key_check;
alter table public.club_platform_role_permissions add constraint club_platform_role_permissions_permission_key_check
  check (permission_key in ('events.read', 'events.import', 'events.edit', 'highland.read', 'highland.import', 'highland.edit', 'dragon.read', 'dragon.import', 'dragon.edit'));

-- 3. Same calculation; dragon import/edit need dragon.read exactly as the other event types.
create or replace function club_private.permission_layer(p_club uuid, p_user uuid, p_role text, p_permission text) returns text
language sql stable set search_path = '' as $$
  select case
    when club_private.layer_allows(l.layer) and p_permission in ('events.import', 'events.edit', 'highland.import', 'highland.edit', 'dragon.import', 'dragon.edit')
      and not club_private.layer_allows(club_private.permission_layer(p_club, p_user, p_role, split_part(p_permission, '.', 1) || '.read')) then 'needs_read'
    else l.layer end
  from (select case
    when p.key is null then 'unregistered'
    when p.non_delegable and p_role <> 'owner' then 'non_delegable'
    when exists(select 1 from public.auth_role_cap_blocks c where c.role_key = p_role and c.permission_key = p.key) then 'cap'
    when f.allowed then 'forced_allow' when not f.allowed then 'forced_deny'
    when pp.allowed then 'platform_allow' when not pp.allowed then 'platform_deny'
    when pr.allowed then 'platform_role_allow' when not pr.allowed then 'platform_role_deny'
    when o.allowed then 'owner_allow' when not o.allowed then 'owner_deny'
    when d.allowed then 'club_allow' when not d.allowed then 'club_deny'
    when exists(select 1 from public.auth_role_permissions rp where rp.role_key = p_role and rp.permission_key = p.key) then 'default_allow'
    else 'default_deny' end as layer
  from (select) one
  left join public.auth_permissions p on p.key = p_permission and 'club' = any(p.allowed_scopes)
  left join public.club_permission_overrides f on f.club_id = p_club and f.user_id = p_user and f.permission_key = p_permission and f.set_by = 'super_admin'
  left join public.club_permission_overrides pp on pp.club_id = p_club and pp.user_id = p_user and pp.permission_key = p_permission and pp.set_by = 'platform' and p_role in ('owner', 'admin')
  left join public.club_platform_role_permissions pr on pr.club_id = p_club and pr.role_key = p_role and pr.permission_key = p_permission
  left join public.club_permission_overrides o on o.club_id = p_club and o.user_id = p_user and o.permission_key = p_permission and o.set_by = 'owner' and p_role = 'admin'
  left join public.club_role_permissions d on d.club_id = p_club and d.role_key = p_role and d.permission_key = p_permission) l;
$$;
revoke all on function club_private.permission_layer(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- 4. Platform-admin dragon permission settings: the highland functions with the dragon keys, permission and audit action.
create function public.platform_dragon_permissions(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.dragon.permissions') then raise exception using errcode = '42501', message = '需要猎龙权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  return jsonb_build_object('club_id', p_club,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id) from public.club_clubs), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'description', description) order by key) from public.auth_permissions where key in ('dragon.read', 'dragon.import', 'dragon.edit')), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.key, 'role_name', r.name, 'mine', exists(select 1 from public.club_memberships m where m.club_id = p_club and m.user_id = (select auth.uid()) and m.role = r.key and m.status = 'active'),
        'settings', coalesce((select jsonb_object_agg(permission_key, allowed) from public.club_platform_role_permissions where club_id = p_club and role_key = r.key), '{}'::jsonb)) order by r.key = 'admin', r.key)
      from public.auth_roles r where r.key in ('owner', 'admin')), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'self', m.user_id = (select auth.uid()),
        'permissions', (select jsonb_agg(e) from jsonb_array_elements(club_private.permission_explain(p_club, m.user_id)->'permissions') e where e->>'key' in ('dragon.read', 'dragon.import', 'dragon.edit')))
        order by m.role = 'admin', lower(u.email), m.user_id)
      from public.club_memberships m join auth.users u on u.id = m.user_id where m.club_id = p_club and m.status = 'active' and m.role in ('owner', 'admin')), '[]'::jsonb));
end $$;

create function public.platform_set_dragon_permission(p_club uuid, p_role text, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); held text; old boolean; n integer := 0;
begin
  if not club_private.can_platform('platform.dragon.permissions') then raise exception using errcode = '42501', message = '需要猎龙权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or p_permission is null or p_permission not in ('dragon.read', 'dragon.import', 'dragon.edit')
    or (p_role is null) = (p_user is null) or (p_role is not null and p_role not in ('owner', 'admin')) then
    raise exception using errcode = '22023', message = '权限设置参数无效';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  if not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  if not club_private.super_admin_active() and (p_user = actor
    or (p_role is not null and exists(select 1 from public.club_memberships where club_id = p_club and user_id = actor and role = p_role and status = 'active'))) then
    raise exception using errcode = '42501', message = '不能修改自己的权限';
  end if;
  if p_user is not null then
    select allowed into old from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'platform';
    if p_value is null then
      delete from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'platform';
    else
      select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active' for share;
      if held is null or held not in ('owner', 'admin') then raise exception using errcode = 'PT409', message = '该账户在此俱乐部没有公会长或管理员职位'; end if;
      insert into public.club_permission_overrides(club_id, user_id, permission_key, set_by, allowed) values (p_club, p_user, p_permission, 'platform', p_value)
        on conflict (club_id, user_id, permission_key, set_by) do update set allowed = excluded.allowed where club_permission_overrides.allowed is distinct from excluded.allowed;
    end if;
  else
    select allowed into old from public.club_platform_role_permissions where club_id = p_club and role_key = p_role and permission_key = p_permission;
    if p_value is null then delete from public.club_platform_role_permissions where club_id = p_club and role_key = p_role and permission_key = p_permission;
    else insert into public.club_platform_role_permissions(club_id, role_key, permission_key, allowed) values (p_club, p_role, p_permission, p_value)
      on conflict (club_id, role_key, permission_key) do update set allowed = excluded.allowed where club_platform_role_permissions.allowed is distinct from excluded.allowed; end if;
  end if;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, actor, 'dragon_permission_changed', p_user,
      jsonb_build_object('permission', p_permission, 'description', (select description from public.auth_permissions where key = p_permission), 'role', p_role, 'old', old, 'new', p_value, 'by', 'platform'));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

-- 5. Storage. A hunt is a club_events row (total_score 0, never shown); one row per attending player keeps only the
-- name read from the screenshot.
alter table public.club_events drop constraint club_events_event_type_check;
alter table public.club_events add constraint club_events_event_type_check check (event_type in ('four_way_league', 'highland_race', 'dragon_hunt'));
create table public.club_dragon_event_players (
  club_id uuid not null,
  event_id uuid not null,
  event_type text not null default 'dragon_hunt' check (event_type = 'dragon_hunt'),
  player_id uuid not null,
  read_name text check (read_name is null or length(read_name) <= 200),
  primary key (club_id, event_id, player_id),
  foreign key (club_id, event_id, event_type) references public.club_events(club_id, id, event_type) on delete restrict,
  foreign key (club_id, player_id) references public.club_players(club_id, id) on delete restrict
);
create index club_dragon_event_players_player on public.club_dragon_event_players(club_id, player_id);
alter table public.club_dragon_event_players enable row level security;
revoke all on table public.club_dragon_event_players from public, anon, authenticated, service_role;
create trigger club_dragon_event_players_no_truncate before truncate on public.club_dragon_event_players for each statement execute function club_private.audit_immutable();

create function club_private.dragon_state(p_club uuid, p_event uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('event_date', e.event_date, 'status', e.status,
    'players', coalesce((select jsonb_agg(to_jsonb(r) - 'club_id' - 'event_id' - 'event_type' order by r.player_id) from public.club_dragon_event_players r where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb))
  from public.club_events e where e.club_id = p_club and e.id = p_event;
$$;

-- 6. Writers (start, replay and lock shared with the other event types through event_begin).
-- p_players: [{player_id, read_name, remember_alias}], existing players of this club only (never a new identity).
-- p_unmatched: how many screenshot names the page left out because they match nobody; logged as reported.
create function public.club_dragon_create(p_club uuid, p_date date, p_players jsonb, p_unmatched integer, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; event uuid := gen_random_uuid(); row_data jsonb; player uuid; display text;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('type', 'dragon_hunt', 'date', p_date, 'players', p_players, 'unmatched', p_unmatched)::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'dragon.import', p_request, hash);
  if replay is not null then return replay; end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > club_private.event_today(p_club) then raise exception using errcode = '22023', message = '猎龙日期无效（不能是未来日期）'; end if;
  if p_unmatched is null or p_unmatched not between 0 and 1000 then raise exception using errcode = '22023', message = '未计入人数无效'; end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) not between 1 and 300 then
    raise exception using errcode = '22023', message = '至少需要 1 名参加者（最多 300 名）';
  end if;
  if exists(select 1 from public.club_events where club_id = p_club and event_type = 'dragon_hunt' and event_date = p_date and status = 'active') then
    raise exception using errcode = 'PT409', message = '该日期已有猎龙记录；如需重新导入，请先作废原记录';
  end if;
  insert into public.club_events(id, club_id, event_type, event_date, total_score, created_by) values (event, p_club, 'dragon_hunt', p_date, 0, (select auth.uid()));
  for row_data in select value from jsonb_array_elements(p_players) loop
    if jsonb_typeof(row_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(row_data) k where k not in ('player_id', 'read_name', 'remember_alias'))
      or jsonb_typeof(row_data->'player_id') is distinct from 'string' or row_data->>'player_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (row_data ? 'remember_alias' and jsonb_typeof(row_data->'remember_alias') <> 'boolean')
      or (row_data ? 'read_name' and row_data->'read_name' <> 'null'::jsonb and (jsonb_typeof(row_data->'read_name') <> 'string' or length(row_data->>'read_name') > 200)) then
      raise exception using errcode = '22023', message = '每名参加者都要选择本俱乐部已有的玩家';
    end if;
    player := (row_data->>'player_id')::uuid;
    perform 1 from public.club_players where club_id = p_club and id = player for share;
    if not found then raise exception using errcode = '42501', message = '所选玩家不属于当前俱乐部'; end if;
    if exists(select 1 from public.club_dragon_event_players where club_id = p_club and event_id = event and player_id = player) then
      raise exception using errcode = 'PT409', message = '同一玩家在本次猎龙只能出现一次';
    end if;
    insert into public.club_dragon_event_players(club_id, event_id, player_id, read_name) values (p_club, event, player, nullif(btrim(row_data->>'read_name'), ''));
    -- Remembering an AI misspelling needs aliases.manage (manage_alias checks it); dragon permissions alone never do.
    if row_data->'remember_alias' = 'true'::jsonb and nullif(btrim(row_data->>'read_name'), '') is not null then
      select display_name into display from public.club_players where club_id = p_club and id = player;
      if btrim(row_data->>'read_name') <> btrim(display) then perform club_private.manage_alias(p_club, player, btrim(row_data->>'read_name'), null); end if;
    end if;
  end loop;
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, event, 1, 'create', club_private.dragon_state(p_club, event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'dragon_created', event,
    jsonb_build_object('date', p_date, 'participants', jsonb_array_length(p_players), 'unmatched', p_unmatched));
  return jsonb_build_object('event_id', event, 'version', 1, 'replayed', false);
end $$;

-- The only correction: void the whole hunt (it frees the date for a new import).
create function public.club_dragon_void(p_club uuid, p_event uuid, p_expected integer, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; e public.club_events%rowtype;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('type', 'dragon_hunt', 'event', p_event, 'expected', p_expected, 'action', 'void')::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'dragon.edit', p_request, hash);
  if replay is not null then return replay; end if;
  if p_event is null or p_expected is null then raise exception using errcode = '22023', message = '修改参数无效'; end if;
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'dragon_hunt' for update;
  if not found then raise exception using errcode = '22023', message = '找不到这次猎龙'; end if;
  if e.version <> p_expected then raise exception using errcode = 'PT409', message = '这次猎龙已被其他人修改，请刷新后重试'; end if;
  if e.status = 'voided' then raise exception using errcode = 'PT409', message = '这次猎龙已作废'; end if;
  update public.club_events set status = 'voided', version = version + 1 where id = p_event returning version into e.version;
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, p_event, e.version, 'void', club_private.dragon_state(p_club, p_event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'dragon_void', p_event,
    jsonb_build_object('event_date', e.event_date, 'version', e.version));
  return jsonb_build_object('event_id', p_event, 'version', e.version, 'replayed', false);
end $$;

-- 7. Readers: dragon.read through can() (alliance leaders included). Nothing here answers for another event type.
create function club_private.dragon_require_read(p_club uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'dragon.read') then raise exception using errcode = '42501', message = '没有查看猎龙出勤的权限'; end if;
end $$;

create function public.club_dragon_list(p_club uuid, p_voided boolean default false, p_before date default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform club_private.dragon_require_read(p_club);
  with page as (
    select * from public.club_events where club_id = p_club and event_type = 'dragon_hunt' and status = case when p_voided then 'voided' else 'active' end
      and (p_before is null or (event_date, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by event_date desc, id desc limit 101
  ), visible as (select * from page order by event_date desc, id desc limit 100)
  select jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'event_date', v.event_date, 'status', v.status, 'version', v.version,
      'participants', (select count(*) from public.club_dragon_event_players r where r.club_id = p_club and r.event_id = v.id)) order by v.event_date desc, v.id desc)
    from visible v), '[]'::jsonb),
    'next', case when (select count(*) from page) > 100 then (select jsonb_build_object('before', event_date, 'id', id) from visible order by event_date, id limit 1) end) into result;
  return result;
end $$;

create function public.club_dragon_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype;
begin
  perform club_private.dragon_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'dragon_hunt';
  if not found then return null; end if;
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'created_at', e.created_at),
    'players', coalesce((select jsonb_agg(jsonb_build_object('player_id', r.player_id, 'read_name', r.read_name, 'display_name', p.display_name) order by p.display_name, r.player_id)
      from public.club_dragon_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb));
end $$;

-- Names for matching: the highland identity list, answered for dragon importers.
create function public.club_dragon_identities(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare latest uuid;
begin
  if not club_private.can(p_club, 'dragon.import') then raise exception using errcode = '42501', message = '没有导入猎龙出勤的权限'; end if;
  select id into latest from public.club_snapshots where club_id = p_club and is_current and deleted_at is null order by snapshot_date desc, revision desc limit 1;
  return jsonb_build_object(
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'current', current) order by display_name, id)
      from (select p.id, p.display_name, exists(select 1 from public.club_snapshot_players s where s.club_id = p_club and s.snapshot_id = latest and s.player_id = p.id) as current
        from public.club_players p where p.club_id = p_club order by 3 desc, p.id limit 3000) x), '[]'::jsonb),
    'aliases', coalesce((select jsonb_agg(jsonb_build_object('player_id', player_id, 'alias_name', alias_name))
      from (select player_id, alias_name from public.club_player_aliases where club_id = p_club and revoked_at is null order by id limit 10000) a), '[]'::jsonb),
    'truncated', (select count(*) from public.club_players where club_id = p_club) > 3000
      or (select count(*) from public.club_player_aliases where club_id = p_club and revoked_at is null) > 10000,
    'roster_date', (select snapshot_date from public.club_snapshots where id = latest),
    'can_alias', club_private.can(p_club, 'aliases.manage'));
end $$;

-- 8. Attendance: the shared rule, now also for dragon hunts (attended = has a row; the hunt has no metrics).
create or replace function club_private.event_attendance(p_club uuid, p_player uuid, p_type text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with events as (
    select e.id, e.event_date, m.metrics is not null as attended, m.metrics
    from public.club_events e left join lateral (
      select to_jsonb(r) - 'club_id' - 'event_id' - 'player_id' - 'origin' - 'output_name' - 'strategy_name' as metrics
        from public.club_event_players r where p_type = 'four_way_league' and r.club_id = e.club_id and r.event_id = e.id and r.player_id = p_player
      union all
      select to_jsonb(h) - 'club_id' - 'event_id' - 'event_type' - 'player_id' - 'origin' - 'output_name' - 'strategy_name'
        from public.club_highland_event_players h where p_type = 'highland_race' and h.club_id = e.club_id and h.event_id = e.id and h.player_id = p_player
      union all
      select '{}'::jsonb
        from public.club_dragon_event_players d where p_type = 'dragon_hunt' and d.club_id = e.club_id and d.event_id = e.id and d.player_id = p_player) m on true
    where e.club_id = p_club and e.event_type = p_type and e.status = 'active'
  ), seen as (
    select s.snapshot_date from public.club_snapshots s join public.club_snapshot_players r on r.club_id = s.club_id and r.snapshot_id = s.id and r.player_id = p_player
    where s.club_id = p_club and s.is_current and s.deleted_at is null
  ), rosters as (
    select s.snapshot_date, s.is_complete_roster, coalesce(res.decision, a.decision) as decision from public.club_snapshots s
    left join public.club_snapshot_absences a on a.club_id = s.club_id and a.snapshot_id = s.id and a.player_id = p_player
    left join public.club_absence_resolutions res on res.club_id = s.club_id and res.snapshot_id = s.id and res.player_id = p_player
    where s.club_id = p_club and s.is_current and s.deleted_at is null
      and not exists(select 1 from public.club_snapshot_players r where r.club_id = s.club_id and r.snapshot_id = s.id and r.player_id = p_player)
  ), judged as (
    select e.*, b.before, b.after,
      not e.attended and b.before is not null and b.after is not null and (b.before = e.event_date
        or not exists(select 1 from rosters g where g.snapshot_date > b.before and g.snapshot_date < b.after and g.decision is distinct from 'missed')) as absent,
      exists(select 1 from rosters g where g.snapshot_date > b.before and g.snapshot_date <= e.event_date and (g.decision = 'left' or (g.decision is null and g.is_complete_roster))) as departed
    from events e cross join lateral (select (select max(snapshot_date) from seen where snapshot_date <= e.event_date) as before,
      (select min(snapshot_date) from seen where snapshot_date >= e.event_date) as after) b
  ) select jsonb_build_object(
    'attended', coalesce((select jsonb_agg(jsonb_build_object('event_id', id, 'event_date', event_date) || metrics order by event_date desc) from judged where attended), '[]'::jsonb),
    'absent', coalesce((select jsonb_agg(jsonb_build_object('event_id', id, 'event_date', event_date) order by event_date desc) from judged where absent), '[]'::jsonb),
    'uncertain', (select count(*) from judged where not attended and not absent and before is not null and not departed));
$$;
create function public.club_player_dragon(p_club uuid, p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.dragon_require_read(p_club);
  if not exists(select 1 from public.club_players where club_id = p_club and id = p_player) then return null; end if;
  return club_private.event_attendance(p_club, p_player, 'dragon_hunt');
end $$;

do $$
declare f text;
begin
  foreach f in array array['club_private.dragon_state(uuid,uuid)', 'club_private.dragon_require_read(uuid)', 'club_private.event_attendance(uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  foreach f in array array['public.platform_dragon_permissions(uuid)', 'public.platform_set_dragon_permission(uuid,text,uuid,text,boolean)',
    'public.club_dragon_create(uuid,date,jsonb,integer,uuid)', 'public.club_dragon_void(uuid,uuid,integer,uuid)',
    'public.club_dragon_list(uuid,boolean,date,uuid)', 'public.club_dragon_detail(uuid,uuid)',
    'public.club_dragon_identities(uuid)', 'public.club_player_dragon(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
