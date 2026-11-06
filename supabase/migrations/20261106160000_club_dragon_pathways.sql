-- Display-only enrichment: use the last known pathway at the event date, never future data.
create or replace function public.club_dragon_detail(p_club uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.club_events%rowtype;
begin
  perform club_private.dragon_require_read(p_club);
  select * into e from public.club_events where club_id = p_club and id = p_event and event_type = 'dragon_hunt';
  if not found then return null; end if;
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'created_at', e.created_at),
    'players', coalesce((select jsonb_agg(jsonb_build_object('player_id', r.player_id, 'read_name', r.read_name, 'display_name', p.display_name, 'pathway', (select sp.pathway from public.club_snapshot_players sp join public.club_snapshots s on s.club_id = sp.club_id and s.id = sp.snapshot_id where sp.club_id = p_club and sp.player_id = r.player_id and s.is_current and s.deleted_at is null and s.snapshot_date <= e.event_date order by s.snapshot_date desc, s.revision desc limit 1)) order by p.display_name, r.player_id)
      from public.club_dragon_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb));
end $$;

