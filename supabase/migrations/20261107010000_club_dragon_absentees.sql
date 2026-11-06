-- Exact-day latest valid roster minus attendees by UUID; never infer absence from another date.
create or replace function public.club_dragon_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype; roster public.club_snapshots%rowtype;
begin
  perform club_private.dragon_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'dragon_hunt';
  if not found then return null; end if;
  select * into roster from public.club_snapshots where club_id = p_club and snapshot_date = e.event_date and is_current and deleted_at is null order by revision desc limit 1;
  return jsonb_build_object(
    'roster', case when roster.id is null then null else jsonb_build_object('date', roster.snapshot_date, 'revision', roster.revision, 'complete', roster.is_complete_roster) end,
    'absent', case when e.status <> 'active' or roster.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('player_id', sp.player_id, 'display_name', sp.name, 'pathway', sp.pathway) order by sp.name, sp.player_id)
      from public.club_snapshot_players sp where sp.club_id = p_club and sp.snapshot_id = roster.id
      and not exists(select 1 from public.club_dragon_event_players r where r.club_id = p_club and r.event_id = p_event and r.player_id = sp.player_id)), '[]'::jsonb) end,
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'created_at', e.created_at),
    'players', coalesce((select jsonb_agg(jsonb_build_object('player_id', r.player_id, 'read_name', r.read_name, 'display_name', p.display_name, 'pathway', (select sp.pathway from public.club_snapshot_players sp join public.club_snapshots s on s.club_id = sp.club_id and s.id = sp.snapshot_id where sp.club_id = p_club and sp.player_id = r.player_id and s.is_current and s.deleted_at is null and s.snapshot_date <= e.event_date order by s.snapshot_date desc, s.revision desc limit 1)) order by p.display_name, r.player_id)
      from public.club_dragon_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb));
end $$;

