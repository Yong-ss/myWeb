-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
do $$
declare
 c uuid := 'ce0c7103-1cdf-4b08-8619-f71d4915f598';
 d date := '2099-12-01';
 rows jsonb := '[{"name":"B fixture A","position":null,"level":1,"pathway":null,"extraordinary_score":10,"prosperity":null,"weekly_activity":0,"group":null,"join_days":null,"player_id":null},{"name":"B fixture B","position":null,"level":2,"pathway":null,"extraordinary_score":20,"prosperity":null,"weekly_activity":0,"group":null,"join_days":null,"player_id":null}]';
 mapped jsonb;
 first_result jsonb; second_result jsonb; result jsonb;
 first_id uuid; second_id uuid; test_player_id uuid;
 n integer;
begin
 first_result:=public.club_commit_import(c,d,false,'replace',rows,'original', '00000000-0000-4000-8000-000000000011',null,true);
 first_id:=(first_result->>'snapshot_id')::uuid;
 if first_result->>'revision'<>'1' then raise exception 'Initial revision failed'; end if;
 result:=public.club_commit_import(c,d,false,'replace',rows,'original', '00000000-0000-4000-8000-000000000011',null,true);
 if result->>'replayed'<>'true' then raise exception 'Request retry duplicated data'; end if;
 begin
   perform public.club_commit_import(c,d,true,'replace',rows,'changed', '00000000-0000-4000-8000-000000000011',null,true);
   raise exception 'Reused request ID accepted changed content';
 exception when sqlstate '22023' then null; end;
 select jsonb_agg((to_jsonb(s)-'club_id'-'snapshot_id'-'group_name')||jsonb_build_object('group',s.group_name) order by s.name) into mapped
   from public.club_snapshot_players s where club_id=c and snapshot_id=first_id;
 result:=public.club_commit_import(c,d,false,'replace',mapped,'same corrected values', '00000000-0000-4000-8000-000000000012',first_id,true);
 if result->>'unchanged'<>'true' then raise exception 'Identical effective snapshot not deduplicated'; end if;
 test_player_id:=(mapped->0->>'player_id')::uuid;
 mapped:=jsonb_build_array((mapped->0)||'{"level":null,"extraordinary_score":30}');
 second_result:=public.club_commit_import(c,d,false,'merge',mapped,'correction', '00000000-0000-4000-8000-000000000013',first_id,true);
 second_id:=(second_result->>'snapshot_id')::uuid;
 if second_result->>'revision'<>'2' or (select count(*) from public.club_snapshot_players where club_id=c and snapshot_id=second_id)<>2 then raise exception 'Merge lost unsubmitted player'; end if;
 if (select level from public.club_snapshot_players where club_id=c and snapshot_id=second_id and club_snapshot_players.player_id=test_player_id) is not null then raise exception 'Null was replaced by an old value'; end if;
 if (select level from public.club_snapshot_players where club_id=c and snapshot_id=first_id and club_snapshot_players.player_id=test_player_id)<>1 then raise exception 'Old version changed'; end if;
 begin
   perform public.club_commit_import(c,d,false,'replace',mapped,'stale',gen_random_uuid(),first_id,true);
   raise exception 'Stale revision accepted';
 exception when sqlstate 'PT409' then null; end;
 select count(*) into n from public.club_players where club_id=c;
 begin
   -- Explicitly confirm the repeated name so this fixture reaches the tenant check.
   perform public.club_commit_import(c,d,false,'replace',jsonb_build_array((rows->0)||'{"identity_confirmed":true}',(mapped->0)||'{"player_id":"00000000-0000-4000-8000-000000000099","identity_confirmed":true}'),'invalid identity',gen_random_uuid(),second_id,true);
   raise exception 'Unknown or foreign player accepted';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.club_players where club_id=c)<>n then raise exception 'Failed transaction left partial players'; end if;
 begin
   perform public.club_commit_import(c,d,false,'merge',mapped||mapped,'duplicate identity',gen_random_uuid(),second_id,true);
   raise exception 'Duplicate identity accepted';
 exception when sqlstate '22023' then null; end;
 result:=public.club_commit_import(c,d,false,'replace',mapped,'replace',gen_random_uuid(),second_id,true);
 if result->>'revision'<>'3' or (select count(*) from public.club_snapshot_players where club_id=c and snapshot_id=(result->>'snapshot_id')::uuid)<>1 then raise exception 'Replacement failed'; end if;
 if (select count(*) from public.club_snapshots where club_id=c and snapshot_date=d)<>3 then raise exception 'Revision history lost'; end if;
 if (select count(*) from public.club_snapshots where club_id=c and snapshot_date=d and is_current)<>1 then raise exception 'More than one current revision'; end if;
 if (select count(*) from public.club_audit_events where club_id=c and action='import_committed' and target_id in (first_id,second_id,(result->>'snapshot_id')::uuid))<>3 then raise exception 'Audit trail missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin
 begin
  perform public.club_commit_import('ce0c7103-1cdf-4b08-8619-f71d4915f598','2099-12-02',false,'replace','[]','x',gen_random_uuid(),null,true);
  raise exception 'Unrelated user can import';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Changing the current user's club role is test-only and rolled back.
update public.club_memberships set role='admin' where club_id='ce0c7103-1cdf-4b08-8619-f71d4915f598' and user_id='d0ddb226-a10a-471c-be4b-d5e5153bd313';
set local role authenticated;
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
do $$ declare admin_rows jsonb; begin
 if not exists(select 1 from public.club_players where club_id='ce0c7103-1cdf-4b08-8619-f71d4915f598' and display_name='B fixture A') then raise exception 'Admin read failed'; end if;
 if has_function_privilege('anon','public.club_commit_import(uuid,date,boolean,text,jsonb,text,uuid,uuid,boolean)','EXECUTE') then raise exception 'Anonymous RPC executable'; end if;
 select jsonb_build_array((to_jsonb(s)-'club_id'-'snapshot_id'-'group_name')||jsonb_build_object('group',s.group_name)) into admin_rows
   from public.club_snapshot_players s where club_id='ce0c7103-1cdf-4b08-8619-f71d4915f598' limit 1;
 perform public.club_commit_import('ce0c7103-1cdf-4b08-8619-f71d4915f598','2099-12-02',false,'replace',admin_rows,'admin import fixture',gen_random_uuid(),null,true);
end $$;
reset role;
update public.club_memberships set status='revoked' where club_id='ce0c7103-1cdf-4b08-8619-f71d4915f598' and user_id='d0ddb226-a10a-471c-be4b-d5e5153bd313';
set local role authenticated;
do $$ begin
 begin
  perform public.club_commit_import('ce0c7103-1cdf-4b08-8619-f71d4915f598','2099-12-02',false,'replace','[]','x',gen_random_uuid(),null,true);
  raise exception 'Revoked user can import';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'club_import: versions, merge/replace, null, retry, duplicate, stale revision, rollback, authorization and audit passed' as result;
