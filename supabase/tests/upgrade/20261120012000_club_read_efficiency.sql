-- Compare the deployed readers with the replacement on identical data and the same authenticated role.
insert into public.club_players(id,club_id,display_name,match_name)
values(md5('read-efficiency-player')::uuid,'ce0c7103-1cdf-4b08-8619-f71d4915f598','Read fixture','Read fixture');
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
select md5('read-efficiency-import-'||n)::uuid,'ce0c7103-1cdf-4b08-8619-f71d4915f598',
  'd0ddb226-a10a-471c-be4b-d5e5153bd313','{}',1,md5('read-efficiency-request-'||n)::uuid
from generate_series(0,104) n;
insert into public.club_snapshots(id,club_id,import_id,snapshot_date,revision,is_complete_roster)
select md5('read-efficiency-snapshot-'||n)::uuid,'ce0c7103-1cdf-4b08-8619-f71d4915f598',
  md5('read-efficiency-import-'||n)::uuid,date '2040-01-01'+n,1,true
from generate_series(0,104) n;
insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score)
select 'ce0c7103-1cdf-4b08-8619-f71d4915f598',md5('read-efficiency-snapshot-'||n)::uuid,
  md5('read-efficiency-player')::uuid,'Read fixture',100+n
from generate_series(0,104) n where n not in (4,99,101);
insert into public.club_snapshot_absences(club_id,snapshot_id,player_id,decision)
select 'ce0c7103-1cdf-4b08-8619-f71d4915f598',md5('read-efficiency-snapshot-'||n)::uuid,
  md5('read-efficiency-player')::uuid,'missed' from (values(4),(99),(101)) dates(n);
insert into public.club_absence_resolutions(club_id,snapshot_id,player_id,decision,reason)
select 'ce0c7103-1cdf-4b08-8619-f71d4915f598',md5('read-efficiency-snapshot-'||n)::uuid,
  md5('read-efficiency-player')::uuid,'temporary','Fixture absence' from (values(4),(99)) dates(n);
insert into public.club_events(id,club_id,event_type,event_date,total_score,created_by)
select md5('read-efficiency-event-'||n)::uuid,'ce0c7103-1cdf-4b08-8619-f71d4915f598','dragon_hunt',
  date '2040-01-01'+n,0,'d0ddb226-a10a-471c-be4b-d5e5153bd313'
from (values(-1),(98),(99),(100),(101),(103),(105)) dates(n);
insert into public.club_dragon_event_players(club_id,event_id,player_id,read_name)
values('ce0c7103-1cdf-4b08-8619-f71d4915f598',md5('read-efficiency-event-103')::uuid,
  md5('read-efficiency-player')::uuid,'Read fixture');

-- Invoke the public entry points used by the Worker. The fixture includes an absence at the page boundary,
-- observed rows and days missing for different reasons, plus attendance before, during and after the roster.
create function pg_temp.read_efficiency_results() returns jsonb language sql as $$
  select jsonb_build_object(
    'first',public.club_history_page(c,p),
    'older',public.club_history_page(c,p,p_before=>date '2040-01-06'),
    'at_date',public.club_history_page(c,p,p_date=>date '2040-02-01'),
    'account',public.club_my_context(),
    'attendance',public.club_player_dragon(c,p))
  from (values('ce0c7103-1cdf-4b08-8619-f71d4915f598'::uuid,md5('read-efficiency-player')::uuid)) fixture(c,p);
$$;
set local request.jwt.claim.sub='d0ddb226-a10a-471c-be4b-d5e5153bd313';
set local role authenticated;
create temp table expected_reads as select pg_temp.read_efficiency_results() as value;
reset role;
-- @migrate
set local role authenticated;
do $$
begin
  if pg_temp.read_efficiency_results() is distinct from (select value from expected_reads) then
    raise exception 'Read optimization changed history, page continuity, attendance or account results';
  end if;
end $$;
reset role;
