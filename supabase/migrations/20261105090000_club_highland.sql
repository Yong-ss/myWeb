-- Highland Race V1 (docs/CLUB_HIGHLAND_RACE_DISCUSSION.md). Additive: its own three permissions (independent of the
-- Four-Way League ones), a platform permission to set them per club, its own metric table on the shared club_events
-- lifecycle, and its own readers/writers. The Four-Way League functions keep their signatures and only gain an
-- event_type filter, so the deployed Worker keeps working and can never see a Highland Race event.

-- 1. Registry. Same shape and defaults as the Four-Way League permissions; no row of events.* applies to highland.*.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description) values
  ('highland.read', 'action', '{alliance,club}', true, false, '查看高原竞逐战绩'),
  ('highland.import', 'action', '{club}', false, false, '导入高原竞逐比赛'),
  ('highland.edit', 'action', '{club}', false, false, '修改、补录、移除、作废或恢复高原竞逐战绩'),
  ('platform.highland.permissions', 'action', '{platform}', false, true, '按俱乐部设置公会长和管理员的高原竞逐权限');
insert into public.auth_role_permissions(role_key, permission_key) values
  ('owner', 'highland.read'), ('owner', 'highland.import'), ('owner', 'highland.edit'),
  ('admin', 'highland.read'), ('admin', 'highland.import'), ('admin', 'highland.edit'),
  ('alliance_leader', 'highland.read'), ('platform_admin', 'platform.highland.permissions');

-- 2. The platform-admin layer also holds the three highland permissions (rows are per permission key, so a four-way row
-- never answers for highland).
alter table public.club_permission_overrides drop constraint club_permission_overrides_platform_events;
alter table public.club_permission_overrides add constraint club_permission_overrides_platform_events
  check (set_by <> 'platform' or permission_key in ('events.read', 'events.import', 'events.edit', 'highland.read', 'highland.import', 'highland.edit'));
alter table public.club_platform_role_permissions drop constraint club_platform_role_permissions_permission_key_check;
alter table public.club_platform_role_permissions add constraint club_platform_role_permissions_permission_key_check
  check (permission_key in ('events.read', 'events.import', 'events.edit', 'highland.read', 'highland.import', 'highland.edit'));

-- 3. Same calculation; highland import/edit need highland.read exactly as event import/edit need events.read.
create or replace function club_private.permission_layer(p_club uuid, p_user uuid, p_role text, p_permission text) returns text
language sql stable set search_path = '' as $$
  select case
    when club_private.layer_allows(l.layer) and p_permission in ('events.import', 'events.edit', 'highland.import', 'highland.edit')
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

-- 4. Platform-admin highland permission settings: the Four-Way League functions with the highland keys, permission
-- and audit action (no self-promotion, Super Admin and caps above, same layer order).
create function public.platform_highland_permissions(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.highland.permissions') then raise exception using errcode = '42501', message = '需要高原竞逐权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  return jsonb_build_object('club_id', p_club,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id) from public.club_clubs), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'description', description) order by key) from public.auth_permissions where key in ('highland.read', 'highland.import', 'highland.edit')), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.key, 'role_name', r.name, 'mine', exists(select 1 from public.club_memberships m where m.club_id = p_club and m.user_id = (select auth.uid()) and m.role = r.key and m.status = 'active'),
        'settings', coalesce((select jsonb_object_agg(permission_key, allowed) from public.club_platform_role_permissions where club_id = p_club and role_key = r.key), '{}'::jsonb)) order by r.key = 'admin', r.key)
      from public.auth_roles r where r.key in ('owner', 'admin')), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'self', m.user_id = (select auth.uid()),
        'permissions', (select jsonb_agg(e) from jsonb_array_elements(club_private.permission_explain(p_club, m.user_id)->'permissions') e where e->>'key' in ('highland.read', 'highland.import', 'highland.edit')))
        order by m.role = 'admin', lower(u.email), m.user_id)
      from public.club_memberships m join auth.users u on u.id = m.user_id where m.club_id = p_club and m.status = 'active' and m.role in ('owner', 'admin')), '[]'::jsonb));
end $$;

-- Exactly one of p_role (club role level) or p_user (personal); p_value null = follow the lower layers again.
create function public.platform_set_highland_permission(p_club uuid, p_role text, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); held text; old boolean; n integer := 0;
begin
  if not club_private.can_platform('platform.highland.permissions') then raise exception using errcode = '42501', message = '需要高原竞逐权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or p_permission is null or p_permission not in ('highland.read', 'highland.import', 'highland.edit')
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
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, actor, 'highland_permission_changed', p_user,
      jsonb_build_object('permission', p_permission, 'description', (select description from public.auth_permissions where key = p_permission), 'role', p_role, 'old', old, 'new', p_value, 'by', 'platform'));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

-- 5. Storage. club_events holds both types; a type never changes. Highland adds the optional faction (one of the fixed
-- in-game factions, see highland_factions) and that faction's rank (1-4); both stay null for the Four-Way League.
-- The faction names confirmed so far (from the game screenshots); the rest are added by a later migration once known,
-- never guessed. The Club page mirrors this list (src/domain/highland.ts, checked by its test).
create function club_private.highland_factions() returns text[] language sql immutable set search_path = '' as $$
  select array['血皇帝势力']::text[];
$$;
alter table public.club_events drop constraint club_events_event_type_check;
alter table public.club_events add constraint club_events_event_type_check check (event_type in ('four_way_league', 'highland_race'));
alter table public.club_events add column faction text, add column faction_rank smallint;
alter table public.club_events add constraint club_events_faction_check check (faction is null or faction = any(club_private.highland_factions()));
alter table public.club_events add constraint club_events_faction_rank_check check (faction_rank between 1 and 4);
alter table public.club_events add constraint club_events_highland_only check (event_type = 'highland_race' or (faction is null and faction_rank is null));
alter table public.club_events add constraint club_events_typed unique (club_id, id, event_type);
create function club_private.event_type_fixed() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.event_type is distinct from old.event_type then raise exception using errcode = '22023', message = '赛事类型不能修改'; end if;
  return new;
end $$;
create trigger club_events_type_fixed before update on public.club_events for each row execute function club_private.event_type_fixed();
-- The Four-Way League detail tables only ever belong to a Four-Way League event.
create function club_private.event_four_way_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.club_events where club_id = new.club_id and id = new.event_id and event_type = 'four_way_league') then
    raise exception using errcode = '22023', message = '这不是四方联赛赛事';
  end if;
  return new;
end $$;
create trigger club_event_players_four_way before insert or update on public.club_event_players for each row execute function club_private.event_four_way_only();
create trigger club_event_imports_four_way before insert on public.club_event_imports for each row execute function club_private.event_four_way_only();
-- Highland results: one row per confirmed participant of this club, both tables complete, no guardian damage, with
-- the personal merit. Only the names read for this player are kept; the faction-wide AI output is never stored.
create table public.club_highland_event_players (
  club_id uuid not null,
  event_id uuid not null,
  event_type text not null default 'highland_race' check (event_type = 'highland_race'),
  player_id uuid not null,
  origin text not null check (origin in ('import', 'manual')),
  output_name text check (output_name is null or length(output_name) <= 200),
  strategy_name text check (strategy_name is null or length(strategy_name) <= 200),
  kills bigint not null check (kills >= 0), assists bigint not null check (assists >= 0),
  dispersals bigint not null check (dispersals >= 0), awakens bigint not null check (awakens >= 0),
  merit bigint not null check (merit >= 0),
  player_damage bigint not null check (player_damage >= 0), damage_taken bigint not null check (damage_taken >= 0),
  healing bigint not null check (healing >= 0), purification bigint not null check (purification >= 0),
  primary key (club_id, event_id, player_id),
  foreign key (club_id, event_id, event_type) references public.club_events(club_id, id, event_type) on delete restrict,
  foreign key (club_id, player_id) references public.club_players(club_id, id) on delete restrict
);
create index club_highland_event_players_player on public.club_highland_event_players(club_id, player_id);
alter table public.club_highland_event_players enable row level security;
revoke all on table public.club_highland_event_players from public, anon, authenticated, service_role;
create trigger club_highland_event_players_no_truncate before truncate on public.club_highland_event_players for each statement execute function club_private.audit_immutable();
-- Versions are shared (one request id space per club); highland adds the faction correction.
alter table public.club_event_versions drop constraint club_event_versions_action_check;
alter table public.club_event_versions add constraint club_event_versions_action_check
  check (action in ('create', 'score', 'date', 'metrics', 'rebind', 'add', 'remove', 'void', 'restore', 'faction'));

-- 6. Highland helpers.
create function club_private.highland_metric_keys() returns text[] language sql immutable set search_path = '' as $$
  select array['kills', 'assists', 'dispersals', 'awakens', 'merit', 'player_damage', 'damage_taken', 'healing', 'purification']::text[];
$$;
create function club_private.highland_metrics_valid(p jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(coalesce(jsonb_typeof(p->k) = 'number' and (p->>k)::numeric >= 0 and (p->>k)::numeric <= 9007199254740991 and trunc((p->>k)::numeric) = (p->>k)::numeric, false)), false)
  from unnest(club_private.highland_metric_keys()) k;
$$;
create function club_private.highland_state(p_club uuid, p_event uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('event_date', e.event_date, 'total_score', e.total_score, 'status', e.status, 'faction', e.faction, 'faction_rank', e.faction_rank,
    'players', coalesce((select jsonb_agg(to_jsonb(r) - 'club_id' - 'event_id' - 'event_type' order by r.player_id) from public.club_highland_event_players r where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb))
  from public.club_events e where e.club_id = p_club and e.id = p_event;
$$;
-- Faction (null or a known faction) and rank (null or 1-4), both optional and independent.
create function club_private.highland_faction_valid(p_faction jsonb, p_rank jsonb) returns boolean language sql immutable set search_path = '' as $$
  select (p_faction = 'null'::jsonb or (jsonb_typeof(p_faction) = 'string' and p_faction #>> '{}' = any(club_private.highland_factions())))
    and (p_rank = 'null'::jsonb or (jsonb_typeof(p_rank) = 'number' and p_rank::text in ('1', '2', '3', '4')));
$$;
-- One participant: an existing player of this club (current or departed; never a new identity, an unmatched name in
-- a faction-wide board is not evidence of a new member) with all nine metrics. Keys: player_id, output_name,
-- strategy_name, remember_alias and the metrics.
create function club_private.highland_insert_player(p_club uuid, p_event uuid, p_row jsonb, p_origin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare player uuid; display text; source text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_row) k where k not in
      ('player_id', 'output_name', 'strategy_name', 'remember_alias', 'kills', 'assists', 'dispersals', 'awakens', 'merit', 'player_damage', 'damage_taken', 'healing', 'purification'))
    or not club_private.highland_metrics_valid(p_row)
    or (p_row ? 'remember_alias' and jsonb_typeof(p_row->'remember_alias') <> 'boolean')
    or exists(select 1 from unnest(array['output_name', 'strategy_name']) k where p_row ? k and p_row->k <> 'null'::jsonb and (jsonb_typeof(p_row->k) <> 'string' or length(p_row->>k) > 200)) then
    raise exception using errcode = '22023', message = '参赛者资料不完整：每人需要完整的输出和战略数据（非负整数）';
  end if;
  if jsonb_typeof(p_row->'player_id') is distinct from 'string' or p_row->>'player_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = '每名参赛者都要选择本俱乐部已有的玩家';
  end if;
  player := (p_row->>'player_id')::uuid;
  perform 1 from public.club_players where club_id = p_club and id = player for share;
  if not found then raise exception using errcode = '42501', message = '所选玩家不属于当前俱乐部'; end if;
  if exists(select 1 from public.club_highland_event_players where club_id = p_club and event_id = p_event and player_id = player) then
    raise exception using errcode = 'PT409', message = '同一玩家在本场只能有一条战绩';
  end if;
  insert into public.club_highland_event_players(club_id, event_id, player_id, origin, output_name, strategy_name, kills, assists, dispersals, awakens, merit, player_damage, damage_taken, healing, purification)
  values (p_club, p_event, player, p_origin, nullif(btrim(p_row->>'output_name'), ''), nullif(btrim(p_row->>'strategy_name'), ''),
    (p_row->>'kills')::bigint, (p_row->>'assists')::bigint, (p_row->>'dispersals')::bigint, (p_row->>'awakens')::bigint, (p_row->>'merit')::bigint,
    (p_row->>'player_damage')::bigint, (p_row->>'damage_taken')::bigint, (p_row->>'healing')::bigint, (p_row->>'purification')::bigint);
  -- Remembering an AI misspelling needs aliases.manage (manage_alias checks it); highland permissions alone never do.
  if p_row->'remember_alias' = 'true'::jsonb then
    select display_name into display from public.club_players where club_id = p_club and id = player;
    for source in select distinct btrim(v) from unnest(array[p_row->>'output_name', p_row->>'strategy_name']) v where nullif(btrim(v), '') is not null and btrim(v) <> btrim(display) loop
      perform club_private.manage_alias(p_club, player, source, null);
    end loop;
  end if;
  return player;
end $$;

-- 7. Writers (start, replay and lock shared with the Four-Way League through event_begin).
-- p_players: the confirmed participants of this club only. p_source: counts the browser reports about the faction-wide
-- AI output it filtered ({output_rows, strategy_rows, excluded_rows}); kept in the log as reported, never verified, and
-- no external player's name or numbers ever reach the database.
create function public.club_highland_create(p_club uuid, p_date date, p_total_score bigint, p_faction text, p_faction_rank integer, p_players jsonb, p_source jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; event uuid := gen_random_uuid(); row_data jsonb;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('type', 'highland_race', 'date', p_date, 'score', p_total_score, 'faction', p_faction, 'rank', p_faction_rank, 'players', p_players, 'source', p_source)::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'highland.import', p_request, hash);
  if replay is not null then return replay; end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > club_private.event_today(p_club) then raise exception using errcode = '22023', message = '比赛日期无效（不能是未来日期）'; end if;
  if p_total_score is null or p_total_score < 0 or p_total_score > 9007199254740991 then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
  if not club_private.highland_faction_valid(coalesce(to_jsonb(p_faction), 'null'::jsonb), coalesce(to_jsonb(p_faction_rank), 'null'::jsonb)) then raise exception using errcode = '22023', message = '势力必须是固定势力之一，名次只能是 1～4，或留空'; end if;
  if jsonb_typeof(p_source) is distinct from 'object' or (select coalesce(array_agg(k order by k collate "C"), '{}') from jsonb_object_keys(p_source) k) <> array['excluded_rows', 'output_rows', 'strategy_rows']
    or exists(select 1 from jsonb_each(p_source) s where jsonb_typeof(s.value) <> 'number' or s.value::text !~ '^\d{1,6}$') then
    raise exception using errcode = '22023', message = '来源统计无效';
  end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) not between 1 and 300 then
    raise exception using errcode = '22023', message = '至少需要 1 名本俱乐部参赛者（最多 300 名）';
  end if;
  if exists(select 1 from public.club_events where club_id = p_club and event_type = 'highland_race' and event_date = p_date and status = 'active') then
    raise exception using errcode = 'PT409', message = '该日期已有高原竞逐记录，请到赛事详情修正';
  end if;
  insert into public.club_events(id, club_id, event_type, event_date, total_score, faction, faction_rank, created_by)
    values (event, p_club, 'highland_race', p_date, p_total_score, p_faction, p_faction_rank, (select auth.uid()));
  for row_data in select value from jsonb_array_elements(p_players) loop
    perform club_private.highland_insert_player(p_club, event, row_data, 'import');
  end loop;
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, event, 1, 'create', club_private.highland_state(p_club, event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'highland_created', event,
    jsonb_build_object('date', p_date, 'total_score', p_total_score, 'faction', p_faction, 'faction_rank', p_faction_rank, 'participants', jsonb_array_length(p_players), 'reported_source', p_source));
  return jsonb_build_object('event_id', event, 'version', 1, 'replayed', false);
end $$;

-- One correction per call against the version the editor saw. Actions and payload keys:
-- score {total_score} | date {event_date} | faction {faction, faction_rank} | metrics {player_id, nine metrics}
-- | rebind {from_player, to_player} | add {participant as in create} | remove {player_id} | void {} | restore {}.
create function public.club_highland_update(p_club uuid, p_event uuid, p_expected integer, p_action text, p_payload jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; e public.club_events%rowtype; keys text[]; details jsonb; target uuid; dest uuid; old_row jsonb; new_date date; score numeric;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('type', 'highland_race', 'event', p_event, 'expected', p_expected, 'action', p_action, 'payload', p_payload)::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'highland.edit', p_request, hash);
  if replay is not null then return replay; end if;
  keys := case p_action when 'score' then array['total_score'] when 'date' then array['event_date'] when 'remove' then array['player_id']
    when 'faction' then array['faction', 'faction_rank'] when 'rebind' then array['from_player', 'to_player']
    when 'void' then array[]::text[] when 'restore' then array[]::text[]
    when 'metrics' then (select array_agg(k order by k collate "C") from unnest(club_private.highland_metric_keys() || 'player_id'::text) k) end;
  if p_event is null or p_expected is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_action is distinct from 'add' and (keys is null or (select coalesce(array_agg(k order by k collate "C"), '{}') from jsonb_object_keys(p_payload) k) <> keys)) then
    raise exception using errcode = '22023', message = '修改参数无效';
  end if;
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'highland_race' for update;
  if not found then raise exception using errcode = '22023', message = '找不到这场高原竞逐'; end if;
  if e.version <> p_expected then raise exception using errcode = 'PT409', message = '这场比赛已被其他人修改，请刷新后重试'; end if;
  if e.status = 'voided' and p_action <> 'restore' then raise exception using errcode = 'PT409', message = '这场比赛已作废，请先恢复'; end if;
  if p_action = 'score' then
    if jsonb_typeof(p_payload->'total_score') is distinct from 'number' then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
    score := (p_payload->>'total_score')::numeric;
    if score < 0 or score > 9007199254740991 or trunc(score) <> score then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
    if score = e.total_score then raise exception using errcode = '22023', message = '总积分没有变化'; end if;
    update public.club_events set total_score = score::bigint where id = p_event;
    details := jsonb_build_object('old', e.total_score, 'new', score);
  elsif p_action = 'date' then
    begin new_date := (p_payload->>'event_date')::date; exception when others then raise exception using errcode = '22023', message = '比赛日期无效'; end;
    if jsonb_typeof(p_payload->'event_date') is distinct from 'string' or p_payload->>'event_date' !~ '^\d{4}-\d{2}-\d{2}$' or new_date < date '2000-01-01' or new_date > club_private.event_today(p_club) then
      raise exception using errcode = '22023', message = '比赛日期无效（不能是未来日期）';
    end if;
    if new_date = e.event_date then raise exception using errcode = '22023', message = '比赛日期没有变化'; end if;
    if exists(select 1 from public.club_events where club_id = p_club and event_type = 'highland_race' and event_date = new_date and status = 'active' and id <> p_event) then
      raise exception using errcode = 'PT409', message = '该日期已有另一场有效高原竞逐，不能修改为这一天';
    end if;
    update public.club_events set event_date = new_date where id = p_event;
    details := jsonb_build_object('old', e.event_date, 'new', new_date);
  elsif p_action = 'faction' then
    if not club_private.highland_faction_valid(p_payload->'faction', p_payload->'faction_rank') then
      raise exception using errcode = '22023', message = '势力必须是固定势力之一，名次只能是 1～4，或留空';
    end if;
    if e.faction is not distinct from p_payload->>'faction' and e.faction_rank is not distinct from (p_payload->>'faction_rank')::smallint then
      raise exception using errcode = '22023', message = '势力和名次没有变化';
    end if;
    update public.club_events set faction = p_payload->>'faction', faction_rank = (p_payload->>'faction_rank')::smallint where id = p_event;
    details := jsonb_build_object('old', jsonb_build_object('faction', e.faction, 'faction_rank', e.faction_rank), 'new', p_payload);
  elsif p_action in ('metrics', 'remove', 'rebind') then
    begin target := (p_payload->>case when p_action = 'rebind' then 'from_player' else 'player_id' end)::uuid; exception when others then target := null; end;
    select to_jsonb(r) - 'club_id' - 'event_id' - 'event_type' into old_row from public.club_highland_event_players r where club_id = p_club and event_id = p_event and player_id = target for update;
    if old_row is null then raise exception using errcode = 'PT409', message = '本场没有这名玩家的战绩，请刷新'; end if;
    if p_action = 'metrics' then
      if not club_private.highland_metrics_valid(p_payload) then raise exception using errcode = '22023', message = '输出和战略数据必须是非负整数'; end if;
      if (select bool_and((old_row->>k)::numeric = (p_payload->>k)::numeric) from unnest(club_private.highland_metric_keys()) k) then
        raise exception using errcode = '22023', message = '数据没有变化';
      end if;
      update public.club_highland_event_players set kills = (p_payload->>'kills')::bigint, assists = (p_payload->>'assists')::bigint, dispersals = (p_payload->>'dispersals')::bigint,
        awakens = (p_payload->>'awakens')::bigint, merit = (p_payload->>'merit')::bigint, player_damage = (p_payload->>'player_damage')::bigint,
        damage_taken = (p_payload->>'damage_taken')::bigint, healing = (p_payload->>'healing')::bigint, purification = (p_payload->>'purification')::bigint
        where club_id = p_club and event_id = p_event and player_id = target;
      details := jsonb_build_object('player_id', target, 'old', old_row, 'new', p_payload);
    elsif p_action = 'remove' then
      if (select count(*) from public.club_highland_event_players where club_id = p_club and event_id = p_event) <= 1 then
        raise exception using errcode = 'PT409', message = '这是本场最后一名参赛者，不能移除；整场误录请作废';
      end if;
      delete from public.club_highland_event_players where club_id = p_club and event_id = p_event and player_id = target;
      details := jsonb_build_object('player_id', target, 'removed', old_row);
    else
      begin dest := (p_payload->>'to_player')::uuid; exception when others then dest := null; end;
      if dest is null or jsonb_typeof(p_payload->'to_player') <> 'string' then raise exception using errcode = '22023', message = '请选择本俱乐部已有的玩家'; end if;
      perform 1 from public.club_players where club_id = p_club and id = dest for share;
      if not found then raise exception using errcode = '42501', message = '所选玩家不属于当前俱乐部'; end if;
      if dest = target then raise exception using errcode = '22023', message = '身份没有变化'; end if;
      if exists(select 1 from public.club_highland_event_players where club_id = p_club and event_id = p_event and player_id = dest) then
        raise exception using errcode = 'PT409', message = '目标玩家已有该场战绩，不能直接改绑；请先核实并移除确实误录的一条';
      end if;
      update public.club_highland_event_players set player_id = dest where club_id = p_club and event_id = p_event and player_id = target;
      details := jsonb_build_object('from_player', target, 'to_player', dest);
    end if;
  elsif p_action = 'add' then
    -- A manual addition has no read names: refusing them keeps any unchecked text out of the result and the log.
    if p_payload ?| array['output_name', 'strategy_name', 'remember_alias'] then raise exception using errcode = '22023', message = '修改参数无效'; end if;
    target := club_private.highland_insert_player(p_club, p_event, p_payload, 'manual');
    details := jsonb_build_object('player_id', target, 'added', p_payload);
  elsif p_action = 'void' then
    update public.club_events set status = 'voided' where id = p_event;
    details := jsonb_build_object('date', e.event_date);
  elsif p_action = 'restore' then
    if e.status <> 'voided' then raise exception using errcode = 'PT409', message = '这场比赛没有作废'; end if;
    if exists(select 1 from public.club_events where club_id = p_club and event_type = 'highland_race' and event_date = e.event_date and status = 'active') then
      raise exception using errcode = 'PT409', message = '该日期已有另一场有效高原竞逐，不能恢复';
    end if;
    update public.club_events set status = 'active' where id = p_event;
    details := jsonb_build_object('date', e.event_date);
  else
    raise exception using errcode = '22023', message = '修改参数无效';
  end if;
  update public.club_events set version = version + 1 where id = p_event returning version into e.version;
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, p_event, e.version, p_action, club_private.highland_state(p_club, p_event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'highland_' || p_action, p_event,
    details || jsonb_build_object('event_date', (select event_date from public.club_events where id = p_event), 'version', e.version));
  return jsonb_build_object('event_id', p_event, 'version', e.version, 'replayed', false);
end $$;

-- 8. Highland readers: highland.read through can() (alliance leaders included). Nothing here answers for a
-- Four-Way League event, and the Four-Way League readers (below) never answer for a highland one.
create function club_private.highland_require_read(p_club uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'highland.read') then raise exception using errcode = '42501', message = '没有查看高原竞逐战绩的权限'; end if;
end $$;

create function public.club_highland_list(p_club uuid, p_voided boolean default false, p_before date default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform club_private.highland_require_read(p_club);
  with page as (
    select * from public.club_events where club_id = p_club and event_type = 'highland_race' and status = case when p_voided then 'voided' else 'active' end
      and (p_before is null or (event_date, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by event_date desc, id desc limit 101
  ), visible as (select * from page order by event_date desc, id desc limit 100)
  select jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'event_date', v.event_date, 'status', v.status, 'version', v.version,
      'total_score', v.total_score, 'faction', v.faction, 'faction_rank', v.faction_rank, 'participants', s.n, 'total_kills', s.kills, 'total_merit', s.merit) order by v.event_date desc, v.id desc)
    from visible v cross join lateral (select count(*) as n, coalesce(sum(kills), 0) as kills, coalesce(sum(merit), 0) as merit from public.club_highland_event_players r where r.club_id = p_club and r.event_id = v.id) s), '[]'::jsonb),
    'next', case when (select count(*) from page) > 100 then (select jsonb_build_object('before', event_date, 'id', id) from visible order by event_date, id limit 1) end) into result;
  return result;
end $$;

create function public.club_highland_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype;
begin
  perform club_private.highland_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'highland_race';
  if not found then return null; end if;
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'total_score', e.total_score, 'created_at', e.created_at,
      'faction', e.faction, 'faction_rank', e.faction_rank,
      'total_kills', (select coalesce(sum(kills), 0) from public.club_highland_event_players where club_id = p_club and event_id = p_event),
      'total_merit', (select coalesce(sum(merit), 0) from public.club_highland_event_players where club_id = p_club and event_id = p_event)),
    'players', coalesce((select jsonb_agg((to_jsonb(r) - 'club_id' - 'event_id' - 'event_type') || jsonb_build_object('display_name', p.display_name) order by p.display_name, r.player_id)
      from public.club_highland_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'action', action, 'created_at', created_at) order by version desc)
      from public.club_event_versions where club_id = p_club and event_id = p_event), '[]'::jsonb));
end $$;

create function public.club_highland_version(p_club uuid, p_event uuid, p_version integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.highland_require_read(p_club);
  return (select jsonb_build_object('version', v.version, 'action', v.action, 'created_at', v.created_at, 'state', v.state
      || jsonb_build_object('players', coalesce((select jsonb_agg(x || jsonb_build_object('display_name', p.display_name)) from jsonb_array_elements(v.state->'players') x
        left join public.club_players p on p.club_id = p_club and p.id = (x->>'player_id')::uuid), '[]'::jsonb)))
    from public.club_event_versions v join public.club_events e on e.club_id = v.club_id and e.id = v.event_id and e.event_type = 'highland_race'
    where v.club_id = p_club and v.event_id = p_event and v.version = p_version);
end $$;

-- Names for matching a faction-wide board: every player of this club (departed ones too, for history) with `current`
-- = in the latest valid roster (the preferred candidates), and confirmed aliases. `truncated` says a cap was reached
-- instead of silently dropping names. For highland importers and editors only.
create function public.club_highland_identities(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare latest uuid;
begin
  if not (club_private.can(p_club, 'highland.import') or club_private.can(p_club, 'highland.edit')) then
    raise exception using errcode = '42501', message = '没有导入或修改高原竞逐的权限';
  end if;
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

-- 9. Attendance, one event type at a time (the Four-Way League rule of docs/CLUB_EVENTS_DISCUSSION.md §5, unchanged).
-- Attended: has a result row of this type. Absent: no row, and the member history proves the player was in the club
-- that day. Anything unprovable is not an absence; after a first record and without a confirmed departure it is counted
-- as `uncertain` only.
create function club_private.event_attendance(p_club uuid, p_player uuid, p_type text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with events as (
    select e.id, e.event_date, m.metrics is not null as attended, m.metrics
    from public.club_events e left join lateral (
      select to_jsonb(r) - 'club_id' - 'event_id' - 'player_id' - 'origin' - 'output_name' - 'strategy_name' as metrics
        from public.club_event_players r where p_type = 'four_way_league' and r.club_id = e.club_id and r.event_id = e.id and r.player_id = p_player
      union all
      select to_jsonb(h) - 'club_id' - 'event_id' - 'event_type' - 'player_id' - 'origin' - 'output_name' - 'strategy_name'
        from public.club_highland_event_players h where p_type = 'highland_race' and h.club_id = e.club_id and h.event_id = e.id and h.player_id = p_player) m on true
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
create function public.club_player_highland(p_club uuid, p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.highland_require_read(p_club);
  if not exists(select 1 from public.club_players where club_id = p_club and id = p_player) then return null; end if;
  return club_private.event_attendance(p_club, p_player, 'highland_race');
end $$;

-- 10. The Four-Way League functions (same signatures and answers) now see Four-Way League events only, so a highland
-- event id is "not found" there, and highland events never enter its list, edits, versions or attendance.
create or replace function public.club_player_events(p_club uuid, p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.event_require_read(p_club);
  if not exists(select 1 from public.club_players where club_id = p_club and id = p_player) then return null; end if;
  return club_private.event_attendance(p_club, p_player, 'four_way_league');
end $$;

create or replace function public.club_events_list(p_club uuid, p_voided boolean default false, p_before date default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform club_private.event_require_read(p_club);
  with page as (
    select * from public.club_events where club_id = p_club and event_type = 'four_way_league' and status = case when p_voided then 'voided' else 'active' end
      and (p_before is null or (event_date, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by event_date desc, id desc limit 101
  ), visible as (select * from page order by event_date desc, id desc limit 100)
  select jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'event_date', v.event_date, 'status', v.status, 'version', v.version,
      'total_score', v.total_score, 'participants', s.n, 'total_kills', s.kills) order by v.event_date desc, v.id desc)
    from visible v cross join lateral (select count(*) as n, coalesce(sum(kills), 0) as kills from public.club_event_players r where r.club_id = p_club and r.event_id = v.id) s), '[]'::jsonb),
    'next', case when (select count(*) from page) > 100 then (select jsonb_build_object('before', event_date, 'id', id) from visible order by event_date, id limit 1) end) into result;
  return result;
end $$;

create or replace function public.club_event_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype;
begin
  perform club_private.event_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'four_way_league';
  if not found then return null; end if;
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'total_score', e.total_score, 'created_at', e.created_at,
      'total_kills', (select coalesce(sum(kills), 0) from public.club_event_players where club_id = p_club and event_id = p_event)),
    'players', coalesce((select jsonb_agg((to_jsonb(r) - 'club_id' - 'event_id') || jsonb_build_object('display_name', p.display_name) order by p.display_name, r.player_id)
      from public.club_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'action', action, 'created_at', created_at) order by version desc)
      from public.club_event_versions where club_id = p_club and event_id = p_event), '[]'::jsonb),
    'raw_text', case when club_private.can_direct(p_club, 'events.read') then (select raw_text from public.club_event_imports where club_id = p_club and event_id = p_event) end);
end $$;

create or replace function public.club_event_version(p_club uuid, p_event uuid, p_version integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.event_require_read(p_club);
  return (select jsonb_build_object('version', v.version, 'action', v.action, 'created_at', v.created_at, 'state', v.state
      || jsonb_build_object('players', coalesce((select jsonb_agg(x || jsonb_build_object('display_name', p.display_name)) from jsonb_array_elements(v.state->'players') x
        left join public.club_players p on p.club_id = p_club and p.id = (x->>'player_id')::uuid), '[]'::jsonb)))
    from public.club_event_versions v where v.club_id = p_club and v.event_id = p_event and v.version = p_version
      and exists(select 1 from public.club_events e where e.club_id = p_club and e.id = p_event and e.event_type = 'four_way_league'));
end $$;

create or replace function public.club_event_update(p_club uuid, p_event uuid, p_expected integer, p_action text, p_payload jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; e public.club_events%rowtype; keys text[]; details jsonb; target uuid; old_row jsonb; new_date date; score numeric;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('event', p_event, 'expected', p_expected, 'action', p_action, 'payload', p_payload)::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'events.edit', p_request, hash);
  if replay is not null then return replay; end if;
  keys := case p_action when 'score' then array['total_score'] when 'date' then array['event_date'] when 'remove' then array['player_id']
    when 'rebind' then array['from_player', 'name', 'to_player'] when 'void' then array[]::text[] when 'restore' then array[]::text[]
    when 'metrics' then array['assists', 'awakens', 'damage_taken', 'dispersals', 'guardian_damage', 'healing', 'kills', 'player_damage', 'player_id', 'purification'] end;
  if p_event is null or p_expected is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_action is distinct from 'add' and (keys is null or (select coalesce(array_agg(k order by k collate "C"), '{}') from jsonb_object_keys(p_payload) k) <> keys)) then
    raise exception using errcode = '22023', message = '修改参数无效';
  end if;
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'four_way_league' for update;
  if not found then raise exception using errcode = '22023', message = '找不到这场比赛'; end if;
  if e.version <> p_expected then raise exception using errcode = 'PT409', message = '这场比赛已被其他人修改，请刷新后重试'; end if;
  if e.status = 'voided' and p_action <> 'restore' then raise exception using errcode = 'PT409', message = '这场比赛已作废，请先恢复'; end if;
  if p_action = 'score' then
    if jsonb_typeof(p_payload->'total_score') is distinct from 'number' then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
    score := (p_payload->>'total_score')::numeric;
    if score < 0 or score > 9007199254740991 or trunc(score) <> score then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
    if score = e.total_score then raise exception using errcode = '22023', message = '总积分没有变化'; end if;
    update public.club_events set total_score = score::bigint where id = p_event;
    details := jsonb_build_object('old', e.total_score, 'new', score);
  elsif p_action = 'date' then
    begin new_date := (p_payload->>'event_date')::date; exception when others then raise exception using errcode = '22023', message = '比赛日期无效'; end;
    if jsonb_typeof(p_payload->'event_date') is distinct from 'string' or p_payload->>'event_date' !~ '^\d{4}-\d{2}-\d{2}$' or new_date < date '2000-01-01' or new_date > club_private.event_today(p_club) then
      raise exception using errcode = '22023', message = '比赛日期无效（不能是未来日期）';
    end if;
    if new_date = e.event_date then raise exception using errcode = '22023', message = '比赛日期没有变化'; end if;
    if exists(select 1 from public.club_events where club_id = p_club and event_type = e.event_type and event_date = new_date and status = 'active' and id <> p_event) then
      raise exception using errcode = 'PT409', message = '该日期已有另一场有效四方联赛，不能修改为这一天';
    end if;
    update public.club_events set event_date = new_date where id = p_event;
    details := jsonb_build_object('old', e.event_date, 'new', new_date);
  elsif p_action in ('metrics', 'remove', 'rebind') then
    begin target := (p_payload->>case when p_action = 'rebind' then 'from_player' else 'player_id' end)::uuid; exception when others then target := null; end;
    select to_jsonb(r) - 'club_id' - 'event_id' into old_row from public.club_event_players r where club_id = p_club and event_id = p_event and player_id = target for update;
    if old_row is null then raise exception using errcode = 'PT409', message = '本场没有这名玩家的战绩，请刷新'; end if;
    if p_action = 'metrics' then
      if not club_private.event_metrics_valid(p_payload) then raise exception using errcode = '22023', message = '输出和战略数据必须是非负整数'; end if;
      if (select bool_and((old_row->>k)::numeric = (p_payload->>k)::numeric) from unnest(array['kills', 'assists', 'dispersals', 'awakens', 'player_damage', 'damage_taken', 'healing', 'guardian_damage', 'purification']) k) then
        raise exception using errcode = '22023', message = '数据没有变化';
      end if;
      update public.club_event_players set kills = (p_payload->>'kills')::bigint, assists = (p_payload->>'assists')::bigint, dispersals = (p_payload->>'dispersals')::bigint,
        awakens = (p_payload->>'awakens')::bigint, player_damage = (p_payload->>'player_damage')::bigint, damage_taken = (p_payload->>'damage_taken')::bigint,
        healing = (p_payload->>'healing')::bigint, guardian_damage = (p_payload->>'guardian_damage')::bigint, purification = (p_payload->>'purification')::bigint
        where club_id = p_club and event_id = p_event and player_id = target;
      details := jsonb_build_object('player_id', target, 'old', old_row, 'new', p_payload);
    elsif p_action = 'remove' then
      if (select count(*) from public.club_event_players where club_id = p_club and event_id = p_event) <= 1 then
        raise exception using errcode = 'PT409', message = '这是本场最后一名参赛者，不能移除；整场误录请作废';
      end if;
      delete from public.club_event_players where club_id = p_club and event_id = p_event and player_id = target;
      details := jsonb_build_object('player_id', target, 'removed', old_row);
    else
      declare dest uuid;
      begin
        if p_payload->'to_player' = 'null'::jsonb then dest := club_private.event_new_player(p_club, p_payload->>'name');
        else
          if p_payload->'name' <> 'null'::jsonb then raise exception using errcode = '22023', message = '修改参数无效'; end if;
          begin dest := (p_payload->>'to_player')::uuid; exception when others then raise exception using errcode = '22023', message = '玩家身份无效'; end;
          perform 1 from public.club_players where club_id = p_club and id = dest for share;
          if not found then raise exception using errcode = '42501', message = '所选玩家不属于当前俱乐部'; end if;
          if dest = target then raise exception using errcode = '22023', message = '身份没有变化'; end if;
          if exists(select 1 from public.club_event_players where club_id = p_club and event_id = p_event and player_id = dest) then
            raise exception using errcode = 'PT409', message = '目标玩家已有该场战绩，不能直接改绑；请先核实并移除确实误录的一条';
          end if;
        end if;
        update public.club_event_players set player_id = dest where club_id = p_club and event_id = p_event and player_id = target;
        details := jsonb_build_object('from_player', target, 'to_player', dest);
      end;
    end if;
  elsif p_action = 'add' then
    target := club_private.event_insert_player(p_club, p_event, p_payload - 'output_name' - 'strategy_name' - 'remember_alias', 'manual');
    details := jsonb_build_object('player_id', target, 'added', p_payload);
  elsif p_action = 'void' then
    update public.club_events set status = 'voided' where id = p_event;
    details := jsonb_build_object('date', e.event_date);
  elsif p_action = 'restore' then
    if e.status <> 'voided' then raise exception using errcode = 'PT409', message = '这场比赛没有作废'; end if;
    if exists(select 1 from public.club_events where club_id = p_club and event_type = e.event_type and event_date = e.event_date and status = 'active') then
      raise exception using errcode = 'PT409', message = '该日期已有另一场有效比赛，不能恢复';
    end if;
    update public.club_events set status = 'active' where id = p_event;
    details := jsonb_build_object('date', e.event_date);
  else
    raise exception using errcode = '22023', message = '修改参数无效';
  end if;
  update public.club_events set version = version + 1 where id = p_event returning version into e.version;
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, p_event, e.version, p_action, club_private.event_state(p_club, p_event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'event_' || p_action, p_event,
    details || jsonb_build_object('event_date', (select event_date from public.club_events where id = p_event), 'version', e.version));
  return jsonb_build_object('event_id', p_event, 'version', e.version, 'replayed', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array['club_private.highland_factions()', 'club_private.event_type_fixed()', 'club_private.event_four_way_only()',
    'club_private.highland_metric_keys()', 'club_private.highland_metrics_valid(jsonb)', 'club_private.highland_state(uuid,uuid)',
    'club_private.highland_faction_valid(jsonb,jsonb)', 'club_private.highland_insert_player(uuid,uuid,jsonb,text)',
    'club_private.highland_require_read(uuid)', 'club_private.event_attendance(uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  foreach f in array array['public.platform_highland_permissions(uuid)', 'public.platform_set_highland_permission(uuid,text,uuid,text,boolean)',
    'public.club_highland_create(uuid,date,bigint,text,integer,jsonb,jsonb,uuid)', 'public.club_highland_update(uuid,uuid,integer,text,jsonb,uuid)',
    'public.club_highland_list(uuid,boolean,date,uuid)', 'public.club_highland_detail(uuid,uuid)', 'public.club_highland_version(uuid,uuid,integer)',
    'public.club_highland_identities(uuid)', 'public.club_player_highland(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
