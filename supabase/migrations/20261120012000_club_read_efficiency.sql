-- Optimize existing read paths. Same signatures, grants, search paths and authorization checks.

create or replace function public.club_history_page(p_club uuid,p_player uuid,p_date date default null,p_before date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare identity jsonb; days jsonb; first_date date; previous_row jsonb; previous_date date; complete_date date; more boolean; departure_date date;
begin
  select jsonb_build_object('id',id,'display_name',display_name) into identity
    from public.club_players where club_id=p_club and id=p_player;
  if identity is null then return null; end if;
  with page as materialized (
    select id,snapshot_date,revision,is_complete_roster from public.club_snapshots
    where club_id=p_club and is_current and (p_date is null or snapshot_date<=p_date)
      and (p_before is null or snapshot_date<p_before)
    order by snapshot_date desc limit 100
  ), resolved as materialized (
    -- An observed row makes this same day the last sighting, leaving no effective absence after it.
    -- The page has at most 100 days. Resolve once per missing row and reuse both fields.
    select s.*, case when r.player_id is null then public.club_player_absence(p_club,s.id,p_player) end as effective_absence,
      case when r.player_id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(r)-'club_id'-'snapshot_id') end as rows
    from page s left join public.club_snapshot_players r on r.club_id=p_club and r.snapshot_id=s.id and r.player_id=p_player
  ) select min(s.snapshot_date),coalesce(jsonb_agg(jsonb_build_object(
    'snapshot_date',s.snapshot_date,'revision',s.revision,'is_complete_roster',s.is_complete_roster,'confirmed_left',exists(select 1 from public.club_snapshot_absences a where a.club_id=p_club and a.snapshot_id=s.id and a.player_id=p_player and a.decision='left'),
    'absence_decision',s.effective_absence->>'absence_decision','absence_reason',s.effective_absence->>'absence_reason',
    'rows',s.rows
  ) order by s.snapshot_date),'[]'::jsonb) into first_date,days
  from resolved s;
  select to_jsonb(r)-'club_id'-'snapshot_id',s.snapshot_date into previous_row,previous_date
    from public.club_snapshots s join public.club_snapshot_players r on r.club_id=s.club_id and r.snapshot_id=s.id and r.player_id=p_player
    where s.club_id=p_club and s.is_current and s.snapshot_date<first_date order by s.snapshot_date desc limit 1;
  select snapshot_date into complete_date from public.club_snapshots
    where club_id=p_club and is_current and is_complete_roster and snapshot_date<first_date order by snapshot_date desc limit 1;
  select max(s.snapshot_date) into departure_date from public.club_snapshot_absences a join public.club_snapshots s on s.club_id=a.club_id and s.id=a.snapshot_id where a.club_id=p_club and a.player_id=p_player and a.decision='left' and s.is_current and s.snapshot_date<first_date;
  select exists(select 1 from public.club_snapshots where club_id=p_club and is_current and snapshot_date<first_date) into more;
  return jsonb_build_object('player',identity,'days',days,'previous',previous_row,
    'absence',public.club_player_absence(p_club,(select id from public.club_snapshots where club_id=p_club and is_current and deleted_at is null and snapshot_date<first_date order by snapshot_date desc limit 1),p_player),
    'status',case when previous_row is null then null when greatest(complete_date,departure_date)>previous_date then 'left' else 'present' end,
    'next',case when more then first_date else null end);
end $$;

create or replace function public.club_my_context() returns jsonb language sql stable security definer set search_path = '' as $$
  with confirmed as (
    select u.id from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  ), mine as (
    select c.id, c.name, jsonb_agg(m.role order by m.role) as roles
    from confirmed me
    join public.club_memberships m on m.user_id = me.id and m.status = 'active'
    join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
    join public.club_clubs c on c.id = m.club_id
    group by c.id, c.name
  )
  select jsonb_build_object(
    'super_admin', exists(select 1 from confirmed me join public.platform_super_admins s on s.user_id = me.id),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2',
    'super_admin_active', exists(select 1 from confirmed) and club_private.super_admin_active(),
    'platform_permissions', coalesce((select jsonb_agg(key order by key) from public.auth_permissions
      where exists(select 1 from confirmed) and 'platform' = any(allowed_scopes) and club_private.can_platform(key)), '[]'::jsonb),
    -- Stop at the first permission allowed by the same live check used by club_my_permissions().
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'roles', x.roles) order by x.name, x.id)
      from mine x where exists(select 1 from public.auth_permissions p where club_private.can(x.id,p.key))), '[]'::jsonb));
$$;

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
  ), evidence as (
    -- Compute nearest sightings in two ordered passes. Same-day rows share a frame, so a sighting
    -- on the event date satisfies both bounds. Direct attendance needs no roster inference.
    select snapshot_date as day, true as observed, null::uuid as event_id from seen
    where exists(select 1 from events where not attended)
    union all
    select event_date, false, id from events where not attended
  ), bounds as (
    select event_id,
      max(day) filter (where observed) over (order by day) as before,
      min(day) filter (where observed) over (order by day desc) as after
    from evidence
  ), judged as (
    select e.*, b.before, b.after,
      not e.attended and b.before is not null and b.after is not null and (b.before = e.event_date
        or not exists(select 1 from rosters g where g.snapshot_date > b.before and g.snapshot_date < b.after and g.decision is distinct from 'missed')) as absent,
      exists(select 1 from rosters g where g.snapshot_date > b.before and g.snapshot_date <= e.event_date and (g.decision = 'left' or (g.decision is null and g.is_complete_roster))) as departed
    from events e left join bounds b on b.event_id=e.id
  ) select jsonb_build_object(
    'attended', coalesce((select jsonb_agg(jsonb_build_object('event_id', id, 'event_date', event_date) || metrics order by event_date desc) from judged where attended), '[]'::jsonb),
    'absent', coalesce((select jsonb_agg(jsonb_build_object('event_id', id, 'event_date', event_date) order by event_date desc) from judged where absent), '[]'::jsonb),
    'uncertain', (select count(*) from judged where not attended and not absent and before is not null and not departed));
$$;
