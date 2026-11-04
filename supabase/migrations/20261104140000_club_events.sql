-- Four-Way League V1 (docs/CLUB_EVENTS_DISCUSSION.md). Three event permissions, a platform-admin layer limited to them,
-- event storage with versions, and the readers/writers the Worker calls. Additive: no existing function signature
-- changes and every existing permission keeps its result (the new layers only hold rows for the event permissions;
-- supabase/tests/club_events.sql proves the old permissions are unchanged), so the deployed Worker keeps working.

-- 1. Registry. Read is club + alliance scoped and read-only, so alliance leaders read through can_alliance_read();
-- import and edit are club writes. The platform-admin power is its own platform permission (never platform.permissions.manage).
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, description) values
  ('events.read', 'action', '{alliance,club}', true, false, '查看四方联赛战绩'),
  ('events.import', 'action', '{club}', false, false, '导入四方联赛比赛'),
  ('events.edit', 'action', '{club}', false, false, '修改、补录、移除、作废或恢复四方联赛战绩'),
  ('platform.events.permissions', 'action', '{platform}', false, true, '按俱乐部设置公会长和管理员的四方联赛权限');
insert into public.auth_role_permissions(role_key, permission_key) values
  ('owner', 'events.read'), ('owner', 'events.import'), ('owner', 'events.edit'),
  ('admin', 'events.read'), ('admin', 'events.import'), ('admin', 'events.edit'),
  ('alliance_leader', 'events.read'), ('platform_admin', 'platform.events.permissions');

-- 2. Platform-admin layer, event permissions only (checked by the database, not just the RPC).
-- Personal: club_permission_overrides with its own source 'platform' (never 'super_admin').
alter table public.club_permission_overrides drop constraint club_permission_overrides_set_by_check;
alter table public.club_permission_overrides add constraint club_permission_overrides_set_by_check check (set_by in ('super_admin', 'owner', 'platform'));
alter table public.club_permission_overrides add constraint club_permission_overrides_platform_events
  check (set_by <> 'platform' or permission_key in ('events.read', 'events.import', 'events.edit'));
-- Per club role; no row = follow the lower layers.
create table public.club_platform_role_permissions (
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  role_key text not null references public.auth_roles(key) on delete cascade check (role_key in ('owner', 'admin')),
  permission_key text not null references public.auth_permissions(key) on delete restrict check (permission_key in ('events.read', 'events.import', 'events.edit')),
  allowed boolean not null,
  primary key (club_id, role_key, permission_key)
);
alter table public.club_platform_role_permissions enable row level security;
revoke all on table public.club_platform_role_permissions from public, anon, authenticated, service_role;
create trigger club_platform_role_permissions_check before insert or update on public.club_platform_role_permissions for each row execute function club_private.check_permission_layer();
create trigger club_platform_role_permissions_platform_audit after insert or update or delete on public.club_platform_role_permissions
  for each row execute function club_private.platform_audit_row('club_id', 'role_key', 'permission_key', 'allowed');
create trigger club_platform_role_permissions_no_truncate before truncate on public.club_platform_role_permissions for each statement execute function club_private.audit_immutable();

-- 3. The calculation (same signature). Order: system safety, Super Admin cap, Super Admin forced, platform personal,
-- platform club-role, owner personal (admins only), club default, platform default. An event write that would be allowed
-- is 'needs_read' while events.read is not allowed for the same role (the settings themselves are kept).
create or replace function club_private.layer_allows(p_layer text) returns boolean language sql immutable set search_path = '' as $$
  select p_layer in ('forced_allow', 'platform_allow', 'platform_role_allow', 'owner_allow', 'club_allow', 'default_allow');
$$;
create or replace function club_private.permission_layer(p_club uuid, p_user uuid, p_role text, p_permission text) returns text
language sql stable set search_path = '' as $$
  select case
    when club_private.layer_allows(l.layer) and p_permission in ('events.import', 'events.edit')
      and not club_private.layer_allows(club_private.permission_layer(p_club, p_user, p_role, 'events.read')) then 'needs_read'
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
revoke all on function club_private.permission_layer(uuid, uuid, text, text), club_private.layer_allows(text) from public, anon, authenticated, service_role;

-- The explanation adds the two platform values (identical to 20261102171216 otherwise).
create or replace function club_private.permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare held text; confirmed boolean; leads boolean;
begin
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  select email_confirmed_at is not null into confirmed from auth.users where id = p_user;
  if not found then raise exception using errcode = '22023', message = '目标账户不存在'; end if;
  leads := exists(select 1 from public.alliance_leaders l join public.club_alliances a on a.id = l.alliance_id and a.status = 'active'
    join public.club_alliance_members am on am.alliance_id = a.id and am.club_id = p_club and am.status = 'active'
    where l.user_id = p_user and l.status = 'active');
  select m.role into held from public.club_memberships m
    join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
    where m.club_id = p_club and m.user_id = p_user and m.status = 'active';
  return jsonb_build_object('club_id', p_club, 'user_id', p_user, 'role', held, 'role_name', (select name from public.auth_roles where key = held),
    'email_confirmed', confirmed, 'super_admin', exists(select 1 from public.platform_super_admins where user_id = p_user), 'alliance_leader', leads,
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description, 'sensitive', p.sensitive, 'non_delegable', p.non_delegable,
        'layer', x.layer, 'allowed', confirmed and (club_private.layer_allows(x.layer) or (x.via_alliance and f.allowed is distinct from false)),
        'alliance', x.via_alliance,
        'platform_default', exists(select 1 from public.auth_role_permissions where role_key = held and permission_key = p.key),
        'cap_blocked', exists(select 1 from public.auth_role_cap_blocks where role_key = held and permission_key = p.key),
        'club_default', (select allowed from public.club_role_permissions where club_id = p_club and role_key = held and permission_key = p.key),
        'forced', f.allowed,
        'platform_set', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p.key and set_by = 'platform'),
        'platform_role', (select allowed from public.club_platform_role_permissions where club_id = p_club and role_key = held and permission_key = p.key),
        'owner_set', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p.key and set_by = 'owner')
      ) order by p.key)
      from public.auth_permissions p
      left join public.club_permission_overrides f on f.club_id = p_club and f.user_id = p_user and f.permission_key = p.key and f.set_by = 'super_admin'
      cross join lateral (select case when held is null then 'no_role' else club_private.permission_layer(p_club, p_user, held, p.key) end as layer,
        leads and p.read_only and 'alliance' = any(p.allowed_scopes) and exists(select 1 from public.auth_role_permissions rp where rp.role_key = 'alliance_leader' and rp.permission_key = p.key) as via_alliance) x
      where 'club' = any(p.allowed_scopes)), '[]'::jsonb));
end $$;

-- 4. Platform-admin event permission settings. Super Admin (any) or an active platform admin with the permission.
-- No self-promotion: never on your own account or a role you hold in that club (the active Super Admin excepted).
create function public.platform_event_permissions(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can_platform('platform.events.permissions') then raise exception using errcode = '42501', message = '需要四方联赛权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  return jsonb_build_object('club_id', p_club,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id) from public.club_clubs), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'description', description) order by key) from public.auth_permissions where key in ('events.read', 'events.import', 'events.edit')), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.key, 'role_name', r.name, 'mine', exists(select 1 from public.club_memberships m where m.club_id = p_club and m.user_id = (select auth.uid()) and m.role = r.key and m.status = 'active'),
        'settings', coalesce((select jsonb_object_agg(permission_key, allowed) from public.club_platform_role_permissions where club_id = p_club and role_key = r.key), '{}'::jsonb)) order by r.key = 'admin', r.key)
      from public.auth_roles r where r.key in ('owner', 'admin')), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'self', m.user_id = (select auth.uid()),
        'permissions', (select jsonb_agg(e) from jsonb_array_elements(club_private.permission_explain(p_club, m.user_id)->'permissions') e where e->>'key' in ('events.read', 'events.import', 'events.edit')))
        order by m.role = 'admin', lower(u.email), m.user_id)
      from public.club_memberships m join auth.users u on u.id = m.user_id where m.club_id = p_club and m.status = 'active' and m.role in ('owner', 'admin')), '[]'::jsonb));
end $$;

-- Exactly one of p_role (club role level) or p_user (personal); p_value null = follow the lower layers again.
create function public.platform_set_event_permission(p_club uuid, p_role text, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); held text; old boolean; n integer := 0;
begin
  if not club_private.can_platform('platform.events.permissions') then raise exception using errcode = '42501', message = '需要四方联赛权限管理权限，并在本次登录完成两步验证'; end if;
  if p_club is null or p_permission is null or p_permission not in ('events.read', 'events.import', 'events.edit')
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
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, actor, 'event_permission_changed', p_user,
      jsonb_build_object('permission', p_permission, 'description', (select description from public.auth_permissions where key = p_permission), 'role', p_role, 'old', old, 'new', p_value, 'by', 'platform'));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

-- 5. Event storage. Clients have no table access; every read and write is a function below.
create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  event_type text not null check (event_type = 'four_way_league'),
  event_date date not null check (event_date >= date '2000-01-01'),
  status text not null default 'active' check (status in ('active', 'voided')),
  version integer not null default 1 check (version > 0),
  total_score bigint not null check (total_score between 0 and 9007199254740991),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (club_id, id)
);
-- One valid event per club, type and date; a voided event frees its date.
create unique index club_events_one_active on public.club_events(club_id, event_type, event_date) where status = 'active';
create table public.club_event_players (
  club_id uuid not null,
  event_id uuid not null,
  player_id uuid not null,
  origin text not null check (origin in ('import', 'manual')),
  output_name text check (output_name is null or length(output_name) <= 200),
  strategy_name text check (strategy_name is null or length(strategy_name) <= 200),
  kills bigint not null check (kills >= 0), assists bigint not null check (assists >= 0),
  dispersals bigint not null check (dispersals >= 0), awakens bigint not null check (awakens >= 0),
  player_damage bigint not null check (player_damage >= 0), damage_taken bigint not null check (damage_taken >= 0),
  healing bigint not null check (healing >= 0), guardian_damage bigint not null check (guardian_damage >= 0),
  purification bigint not null check (purification >= 0),
  primary key (club_id, event_id, player_id),
  foreign key (club_id, event_id) references public.club_events(club_id, id) on delete restrict,
  foreign key (club_id, player_id) references public.club_players(club_id, id) on delete restrict
);
create index club_event_players_player on public.club_event_players(club_id, player_id);
-- The original AI JSON, kept verbatim and never rewritten.
create table public.club_event_imports (
  event_id uuid primary key,
  club_id uuid not null,
  raw_text text not null check (octet_length(raw_text) between 1 and 262144),
  created_at timestamptz not null default now(),
  foreign key (club_id, event_id) references public.club_events(club_id, id) on delete restrict
);
-- Every successful write is a new version holding the full state after it; request ids make retries idempotent.
create table public.club_event_versions (
  club_id uuid not null,
  event_id uuid not null,
  version integer not null check (version > 0),
  action text not null check (action in ('create', 'score', 'date', 'metrics', 'rebind', 'add', 'remove', 'void', 'restore')),
  state jsonb not null,
  request_id uuid not null,
  request_hash text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (club_id, event_id, version),
  unique (club_id, request_id),
  foreign key (club_id, event_id) references public.club_events(club_id, id) on delete restrict
);
do $$
declare t text;
begin
  foreach t in array array['club_events', 'club_event_players', 'club_event_imports', 'club_event_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function club_private.audit_immutable()', t || '_no_truncate', t);
  end loop;
end $$;
-- History is append-only.
create trigger club_event_imports_immutable before update or delete on public.club_event_imports for each row execute function club_private.audit_immutable();
create trigger club_event_versions_immutable before update or delete on public.club_event_versions for each row execute function club_private.audit_immutable();

-- 6. Helpers (callable only inside the definer functions).
create function club_private.event_today(p_club uuid) returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.club_clubs where id = p_club), 'Asia/Kuala_Lumpur'))::date;
$$;
create function club_private.event_metrics_valid(p jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(coalesce(jsonb_typeof(p->k) = 'number' and (p->>k)::numeric >= 0 and (p->>k)::numeric <= 9007199254740991 and trunc((p->>k)::numeric) = (p->>k)::numeric, false)), false)
  from unnest(array['kills', 'assists', 'dispersals', 'awakens', 'player_damage', 'damage_taken', 'healing', 'guardian_damage', 'purification']) k;
$$;
create function club_private.event_state(p_club uuid, p_event uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('event_date', e.event_date, 'total_score', e.total_score, 'status', e.status,
    'players', coalesce((select jsonb_agg(to_jsonb(r) - 'club_id' - 'event_id' order by r.player_id) from public.club_event_players r where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb))
  from public.club_events e where e.club_id = p_club and e.id = p_event;
$$;
-- A new player only after an explicit choice, never a second identity with the same exact name or confirmed alias.
create function club_private.event_new_player(p_club uuid, p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare n text := btrim(coalesce(p_name, '')); id uuid := gen_random_uuid();
begin
  if length(n) not between 1 and 200 or n ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = '新玩家需要有效昵称'; end if;
  if exists(select 1 from public.club_players where club_id = p_club and btrim(display_name) = n)
    or exists(select 1 from public.club_player_aliases where club_id = p_club and revoked_at is null and alias_name = n) then
    raise exception using errcode = 'PT409', message = '已有同名玩家「' || n || '」，请选择已有玩家';
  end if;
  insert into public.club_players(id, club_id, display_name, match_name) values (id, p_club, n, regexp_replace(n, '[[:space:]、丶·]', '', 'g'));
  return id;
end $$;
-- One participant: both tables complete. Keys: player_id (uuid or null = new), name (new player's name),
-- output_name / strategy_name (AI names), remember_alias, and the nine metrics.
create function club_private.event_insert_player(p_club uuid, p_event uuid, p_row jsonb, p_origin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare player uuid; display text; source text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_row) k where k not in
      ('player_id', 'name', 'output_name', 'strategy_name', 'remember_alias', 'kills', 'assists', 'dispersals', 'awakens', 'player_damage', 'damage_taken', 'healing', 'guardian_damage', 'purification'))
    or not (p_row ? 'player_id') or not club_private.event_metrics_valid(p_row)
    or (p_row ? 'remember_alias' and jsonb_typeof(p_row->'remember_alias') <> 'boolean')
    or exists(select 1 from unnest(array['name', 'output_name', 'strategy_name']) k where p_row ? k and p_row->k <> 'null'::jsonb and (jsonb_typeof(p_row->k) <> 'string' or length(p_row->>k) > 200)) then
    raise exception using errcode = '22023', message = '参赛者资料不完整：每人需要完整的输出和战略数据（非负整数）';
  end if;
  if p_row->'player_id' = 'null'::jsonb then
    player := club_private.event_new_player(p_club, p_row->>'name');
  else
    if jsonb_typeof(p_row->'player_id') <> 'string' or p_row->>'player_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode = '22023', message = '玩家身份无效'; end if;
    player := (p_row->>'player_id')::uuid;
    perform 1 from public.club_players where club_id = p_club and id = player for share;
    if not found then raise exception using errcode = '42501', message = '所选玩家不属于当前俱乐部'; end if;
  end if;
  if exists(select 1 from public.club_event_players where club_id = p_club and event_id = p_event and player_id = player) then
    raise exception using errcode = 'PT409', message = '同一玩家在本场只能有一条战绩';
  end if;
  insert into public.club_event_players(club_id, event_id, player_id, origin, output_name, strategy_name, kills, assists, dispersals, awakens, player_damage, damage_taken, healing, guardian_damage, purification)
  values (p_club, p_event, player, p_origin, nullif(btrim(p_row->>'output_name'), ''), nullif(btrim(p_row->>'strategy_name'), ''),
    (p_row->>'kills')::bigint, (p_row->>'assists')::bigint, (p_row->>'dispersals')::bigint, (p_row->>'awakens')::bigint, (p_row->>'player_damage')::bigint,
    (p_row->>'damage_taken')::bigint, (p_row->>'healing')::bigint, (p_row->>'guardian_damage')::bigint, (p_row->>'purification')::bigint);
  -- Remembering an AI misspelling needs aliases.manage (manage_alias checks it); event permissions alone never do.
  if p_row->'remember_alias' = 'true'::jsonb then
    select display_name into display from public.club_players where club_id = p_club and id = player;
    for source in select distinct btrim(v) from unnest(array[p_row->>'output_name', p_row->>'strategy_name']) v where nullif(btrim(v), '') is not null and btrim(v) <> btrim(display) loop
      perform club_private.manage_alias(p_club, player, source, null);
    end loop;
  end if;
  return player;
end $$;
-- The common start of every write: signed in, club lock, permission (re-checked under the lock), replay.
create function club_private.event_begin(p_club uuid, p_permission text, p_request uuid, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare replay record;
begin
  if (select auth.uid()) is null or not exists(select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = '请先登录已确认邮箱的账户';
  end if;
  if p_request is null then raise exception using errcode = '22023', message = '缺少提交编号'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  perform club_private.require(p_club, p_permission);
  select event_id, version, request_hash into replay from public.club_event_versions where club_id = p_club and request_id = p_request;
  if found then
    if replay.request_hash is distinct from p_hash then raise exception using errcode = '22023', message = '此提交编号已用于其他内容，请刷新后重试'; end if;
    return jsonb_build_object('event_id', replay.event_id, 'version', replay.version, 'replayed', true);
  end if;
  return null;
end $$;

-- 7. Writers.
-- p_players: the confirmed participants (see event_insert_player); p_raw: the AI JSON exactly as pasted.
create function public.club_event_create(p_club uuid, p_date date, p_total_score bigint, p_players jsonb, p_raw text, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; raw jsonb; event uuid := gen_random_uuid(); row_data jsonb;
begin
  hash := encode(sha256(convert_to(jsonb_build_object('date', p_date, 'score', p_total_score, 'players', p_players, 'raw', p_raw)::text, 'UTF8')), 'hex');
  replay := club_private.event_begin(p_club, 'events.import', p_request, hash);
  if replay is not null then return replay; end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > club_private.event_today(p_club) then raise exception using errcode = '22023', message = '比赛日期无效（不能是未来日期）'; end if;
  if p_total_score is null or p_total_score < 0 or p_total_score > 9007199254740991 then raise exception using errcode = '22023', message = '总积分必须是非负整数'; end if;
  if p_raw is null or octet_length(p_raw) not between 1 and 262144 then raise exception using errcode = '22023', message = '原始 JSON 无效'; end if;
  begin raw := p_raw::jsonb; exception when others then raise exception using errcode = '22023', message = '原始 JSON 无效'; end;
  if raw->'schema_version' is distinct from '1'::jsonb or raw->>'event_type' is distinct from 'four_way_league'
    or jsonb_typeof(raw->'output') is distinct from 'array' or jsonb_typeof(raw->'strategy') is distinct from 'array'
    or jsonb_array_length(raw->'output') = 0 or jsonb_array_length(raw->'strategy') = 0 then
    raise exception using errcode = '22023', message = '原始 JSON 必须是四方联赛 V1，且输出和战略两表都有数据';
  end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) not between 1 and 300 then raise exception using errcode = '22023', message = '每场需要 1～300 名参赛者'; end if;
  if exists(select 1 from public.club_events where club_id = p_club and event_type = 'four_way_league' and event_date = p_date and status = 'active') then
    raise exception using errcode = 'PT409', message = '该日期已有四方联赛记录，请到赛事详情修正';
  end if;
  insert into public.club_events(id, club_id, event_type, event_date, total_score, created_by) values (event, p_club, 'four_way_league', p_date, p_total_score, (select auth.uid()));
  for row_data in select value from jsonb_array_elements(p_players) loop
    perform club_private.event_insert_player(p_club, event, row_data, 'import');
  end loop;
  insert into public.club_event_imports(event_id, club_id, raw_text) values (event, p_club, p_raw);
  insert into public.club_event_versions(club_id, event_id, version, action, state, request_id, request_hash, actor_id)
    values (p_club, event, 1, 'create', club_private.event_state(p_club, event), p_request, hash, (select auth.uid()));
  insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, (select auth.uid()), 'event_created', event,
    jsonb_build_object('date', p_date, 'total_score', p_total_score, 'participants', jsonb_array_length(p_players)));
  return jsonb_build_object('event_id', event, 'version', 1, 'replayed', false);
end $$;

-- One correction per call, against the version the editor saw (p_expected). Actions and payload keys:
-- score {total_score} | date {event_date} | metrics {player_id, nine metrics} | rebind {from_player, to_player, name}
-- | add {participant as in create} | remove {player_id} | void {} | restore {}.
create function public.club_event_update(p_club uuid, p_event uuid, p_expected integer, p_action text, p_payload jsonb, p_request uuid) returns jsonb
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
  select * into e from public.club_events where club_id = p_club and id = p_event for update;
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

-- 8. Readers. events.read through can() (alliance leaders included); the raw AI JSON only through can_direct().
create function club_private.event_require_read(p_club uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not club_private.can(p_club, 'events.read') then raise exception using errcode = '42501', message = '没有查看四方联赛战绩的权限'; end if;
end $$;

-- Newest first, 100 per page (cursor: the last date and id shown; voided events may share a date). p_voided lists
-- voided events instead of valid ones.
create function public.club_events_list(p_club uuid, p_voided boolean default false, p_before date default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform club_private.event_require_read(p_club);
  with page as (
    select * from public.club_events where club_id = p_club and status = case when p_voided then 'voided' else 'active' end
      and (p_before is null or (event_date, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by event_date desc, id desc limit 101
  ), visible as (select * from page order by event_date desc, id desc limit 100)
  select jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'event_date', v.event_date, 'status', v.status, 'version', v.version,
      'total_score', v.total_score, 'participants', s.n, 'total_kills', s.kills) order by v.event_date desc, v.id desc)
    from visible v cross join lateral (select count(*) as n, coalesce(sum(kills), 0) as kills from public.club_event_players r where r.club_id = p_club and r.event_id = v.id) s), '[]'::jsonb),
    'next', case when (select count(*) from page) > 100 then (select jsonb_build_object('before', event_date, 'id', id) from visible order by event_date, id limit 1) end) into result;
  return result;
end $$;

create function public.club_event_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype;
begin
  perform club_private.event_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event;
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

create function public.club_event_version(p_club uuid, p_event uuid, p_version integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.event_require_read(p_club);
  return (select jsonb_build_object('version', v.version, 'action', v.action, 'created_at', v.created_at, 'state', v.state
      || jsonb_build_object('players', coalesce((select jsonb_agg(x || jsonb_build_object('display_name', p.display_name)) from jsonb_array_elements(v.state->'players') x
        left join public.club_players p on p.club_id = p_club and p.id = (x->>'player_id')::uuid), '[]'::jsonb)))
    from public.club_event_versions v where v.club_id = p_club and v.event_id = p_event and v.version = p_version);
end $$;

-- Players and confirmed aliases for matching AI names: id and names only, for event importers and editors.
create function public.club_event_identities(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (club_private.can(p_club, 'events.import') or club_private.can(p_club, 'events.edit')) then
    raise exception using errcode = '42501', message = '没有导入或修改四方联赛的权限';
  end if;
  return jsonb_build_object(
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name) order by display_name, id) from (select id, display_name from public.club_players where club_id = p_club order by id limit 2001) p), '[]'::jsonb),
    'aliases', coalesce((select jsonb_agg(jsonb_build_object('player_id', player_id, 'alias_name', alias_name)) from (select player_id, alias_name from public.club_player_aliases where club_id = p_club and revoked_at is null order by id limit 10001) a), '[]'::jsonb),
    'can_alias', club_private.can(p_club, 'aliases.manage'));
end $$;

-- One player's attendance in this club's valid events (docs §5). Attended: has a row. Absent: no row, and the member
-- history proves the player was in the club that day: observed on the day, or observed before and after it with every
-- roster in between either containing them or marking them only as missed by recognition. Anything else (before the
-- first record, after a departure, temporary leave, unresolved, no later roster yet) is not an absence; those after a
-- first record and without a confirmed departure are counted as `uncertain` for the explanation only.
create function public.club_player_events(p_club uuid, p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform club_private.event_require_read(p_club);
  if not exists(select 1 from public.club_players where club_id = p_club and id = p_player) then return null; end if;
  return (with events as (
    select e.id, e.event_date, r.player_id is not null as attended, to_jsonb(r) - 'club_id' - 'event_id' - 'player_id' - 'origin' - 'output_name' - 'strategy_name' as metrics
    from public.club_events e left join public.club_event_players r on r.club_id = e.club_id and r.event_id = e.id and r.player_id = p_player
    where e.club_id = p_club and e.status = 'active'
  ), seen as (
    select s.snapshot_date from public.club_snapshots s join public.club_snapshot_players r on r.club_id = s.club_id and r.snapshot_id = s.id and r.player_id = p_player
    where s.club_id = p_club and s.is_current and s.deleted_at is null
  ), rosters as (
    -- Every valid roster without this player, with the decision recorded for them there (a later resolution wins).
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
    'uncertain', (select count(*) from judged where not attended and not absent and before is not null and not departed)) );
end $$;

do $$
declare f text;
begin
  foreach f in array array['club_private.event_today(uuid)', 'club_private.event_metrics_valid(jsonb)', 'club_private.event_state(uuid,uuid)',
    'club_private.event_new_player(uuid,text)', 'club_private.event_insert_player(uuid,uuid,jsonb,text)', 'club_private.event_begin(uuid,text,uuid,text)',
    'club_private.event_require_read(uuid)', 'club_private.permission_explain(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  foreach f in array array['public.platform_event_permissions(uuid)', 'public.platform_set_event_permission(uuid,text,uuid,text,boolean)',
    'public.club_event_create(uuid,date,bigint,jsonb,text,uuid)', 'public.club_event_update(uuid,uuid,integer,text,jsonb,uuid)',
    'public.club_events_list(uuid,boolean,date,uuid)', 'public.club_event_detail(uuid,uuid)', 'public.club_event_version(uuid,uuid,integer)',
    'public.club_event_identities(uuid)', 'public.club_player_events(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
