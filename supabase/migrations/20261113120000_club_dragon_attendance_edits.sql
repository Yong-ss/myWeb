-- Attendance corrections preserve the full version chain and audit identity.
create function public.club_dragon_attendance_edit(p_club uuid,p_event uuid,p_expected integer,p_request uuid,p_action text,p_player uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hash text; replay jsonb; e public.club_events%rowtype; roster uuid;
begin
 hash := encode(sha256(convert_to(jsonb_build_object('type','dragon_hunt','event',p_event,'expected',p_expected,'action',p_action,'player',p_player)::text,'UTF8')),'hex');
 replay := club_private.event_begin(p_club,'dragon.edit',p_request,hash);
 if replay is not null then return replay; end if;
 if p_event is null or p_expected is null or p_player is null or p_action is null or p_action not in ('add','remove') then raise exception using errcode='22023',message='出勤修改参数无效'; end if;
 select * into e from public.club_events where club_id=p_club and id=p_event and event_type='dragon_hunt' for update;
 if not found then raise exception using errcode='22023',message='找不到这次猎龙'; end if;
 if e.version<>p_expected or e.status<>'active' then raise exception using errcode='PT409',message='记录已更改或作废，请刷新后重试'; end if;
 if p_action='add' then
  select id into roster from public.club_snapshots where club_id=p_club and snapshot_date=e.event_date and is_current and deleted_at is null order by revision desc limit 1 for share;
  if roster is null or not exists(select 1 from public.club_snapshot_players where club_id=p_club and snapshot_id=roster and player_id=p_player) then raise exception using errcode='22023',message='只能添加该活动当天有效名单中的成员，请刷新名单'; end if;
  if exists(select 1 from public.club_dragon_event_players where club_id=p_club and event_id=p_event and player_id=p_player) then raise exception using errcode='PT409',message='此成员已经参加'; end if;
  if (select count(*) from public.club_dragon_event_players where club_id=p_club and event_id=p_event)>=300 then raise exception using errcode='22023',message='最多记录 300 名参加者'; end if;
  insert into public.club_dragon_event_players(club_id,event_id,player_id) values(p_club,p_event,p_player);
 else
  delete from public.club_dragon_event_players where club_id=p_club and event_id=p_event and player_id=p_player;
  if not found then raise exception using errcode='PT409',message='此成员已不在参加名单中'; end if;
 end if;
 update public.club_events set version=version+1 where club_id=p_club and id=p_event returning version into e.version;
 insert into public.club_event_versions(club_id,event_id,version,action,state,request_id,request_hash,actor_id) values(p_club,p_event,e.version,p_action,club_private.dragon_state(p_club,p_event),p_request,hash,(select auth.uid()));
 insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values(p_club,(select auth.uid()),'dragon_attendance_'||p_action,p_event,jsonb_build_object('event_date',e.event_date,'version',e.version,'player_id',p_player));
 return jsonb_build_object('event_id',p_event,'version',e.version,'replayed',false);
end $$;
revoke all on function public.club_dragon_attendance_edit(uuid,uuid,integer,uuid,text,uuid) from public,anon,service_role;
grant execute on function public.club_dragon_attendance_edit(uuid,uuid,integer,uuid,text,uuid) to authenticated;

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
    'can_edit_attendance', true,
    'roster', case when roster.id is null then null else jsonb_build_object('date', roster.snapshot_date, 'revision', roster.revision, 'complete', roster.is_complete_roster) end,
    'absent', case when e.status <> 'active' or roster.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('player_id', sp.player_id, 'display_name', sp.name, 'pathway', sp.pathway) order by sp.name, sp.player_id)
      from public.club_snapshot_players sp where sp.club_id = p_club and sp.snapshot_id = roster.id
      and not exists(select 1 from public.club_dragon_event_players r where r.club_id = p_club and r.event_id = p_event and r.player_id = sp.player_id)), '[]'::jsonb) end,
    'event', jsonb_build_object('id', e.id, 'event_date', e.event_date, 'status', e.status, 'version', e.version, 'created_at', e.created_at),
    'players', coalesce((select jsonb_agg(jsonb_build_object('player_id', r.player_id, 'read_name', r.read_name, 'display_name', p.display_name, 'pathway', (select sp.pathway from public.club_snapshot_players sp join public.club_snapshots s on s.club_id = sp.club_id and s.id = sp.snapshot_id where sp.club_id = p_club and sp.player_id = r.player_id and s.is_current and s.deleted_at is null and s.snapshot_date <= e.event_date order by s.snapshot_date desc, s.revision desc limit 1)) order by p.display_name, r.player_id)
      from public.club_dragon_event_players r join public.club_players p on p.club_id = r.club_id and p.id = r.player_id where r.club_id = p_club and r.event_id = p_event), '[]'::jsonb));
end $$;
