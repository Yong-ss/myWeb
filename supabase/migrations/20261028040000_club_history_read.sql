-- Bounded, invoker-only read. RLS applies to every table, including direct RPC calls.
create index club_snapshots_complete_read on public.club_snapshots(club_id,snapshot_date desc)
  where is_current and is_complete_roster;
create function public.club_history_page(p_club uuid,p_player uuid,p_date date default null,p_before date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare identity jsonb; days jsonb; first_date date; previous_row jsonb; previous_date date; complete_date date; more boolean;
begin
  select jsonb_build_object('id',id,'display_name',display_name) into identity
    from public.club_players where club_id=p_club and id=p_player;
  if identity is null then return null; end if;
  with page as materialized (
    select id,snapshot_date,revision,is_complete_roster from public.club_snapshots
    where club_id=p_club and is_current and (p_date is null or snapshot_date<=p_date)
      and (p_before is null or snapshot_date<p_before)
    order by snapshot_date desc limit 100
  ) select min(s.snapshot_date),coalesce(jsonb_agg(jsonb_build_object(
    'snapshot_date',s.snapshot_date,'revision',s.revision,'is_complete_roster',s.is_complete_roster,
    'rows',case when r.player_id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(r)-'club_id'-'snapshot_id') end
  ) order by s.snapshot_date),'[]'::jsonb) into first_date,days
  from page s left join public.club_snapshot_players r on r.club_id=p_club and r.snapshot_id=s.id and r.player_id=p_player;
  select to_jsonb(r)-'club_id'-'snapshot_id',s.snapshot_date into previous_row,previous_date
    from public.club_snapshots s join public.club_snapshot_players r on r.club_id=s.club_id and r.snapshot_id=s.id and r.player_id=p_player
    where s.club_id=p_club and s.is_current and s.snapshot_date<first_date order by s.snapshot_date desc limit 1;
  select snapshot_date into complete_date from public.club_snapshots
    where club_id=p_club and is_current and is_complete_roster and snapshot_date<first_date order by snapshot_date desc limit 1;
  select exists(select 1 from public.club_snapshots where club_id=p_club and is_current and snapshot_date<first_date) into more;
  return jsonb_build_object('player',identity,'days',days,'previous',previous_row,
    'status',case when previous_row is null then null when complete_date>previous_date then 'left' else 'present' end,
    'next',case when more then first_date else null end);
end $$;
revoke all on function public.club_history_page(uuid,uuid,date,date) from public,anon;
grant execute on function public.club_history_page(uuid,uuid,date,date) to authenticated;
