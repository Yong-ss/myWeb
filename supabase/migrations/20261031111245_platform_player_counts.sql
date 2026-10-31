-- P3.1: aggregate the same effective roster used by /members; never infer presence from identities.
-- Existing platform gate and grants are retained. No business rows or historical migrations change.
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
