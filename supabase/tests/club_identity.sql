-- Isolated fixture only; never execute against a hosted project.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
do $$
declare
 c uuid:='ce0c7103-1cdf-4b08-8619-f71d4915f598';
 row_data jsonb:='{"name":"冷泠月","position":null,"level":70,"pathway":null,"extraordinary_score":100,"prosperity":null,"weekly_activity":0,"group":null,"join_days":1,"player_id":null,"source_name":"冷冷月","identity_confirmed":true,"remember_alias":false}';
 first_result jsonb; pid uuid; other uuid; alias_id uuid; result jsonb;
begin
 first_result:=public.club_commit_import(c,'2099-11-01',true,'replace',jsonb_build_array(row_data),'raw AI',gen_random_uuid(),null,true);
 select player_id into pid from public.club_snapshot_players where snapshot_id=(first_result->>'snapshot_id')::uuid;
 if (select source_name from public.club_snapshot_players where snapshot_id=(first_result->>'snapshot_id')::uuid)<>'冷冷月' then raise exception 'Raw nickname lost'; end if;
 result:=public.club_manage_alias(c,pid,'冷冷月',null); alias_id:=(result->>'id')::uuid;
 row_data:=row_data||jsonb_build_object('player_id',pid,'name','冷冷月','identity_confirmed',false);
 perform public.club_commit_import(c,'2099-11-02',false,'replace',jsonb_build_array(row_data),'alias day',gen_random_uuid(),null,true);
 if (select display_name from public.club_players where id=pid)<>'冷泠月' then raise exception 'AI overwrote formal nickname'; end if;
 -- Explicit same-name different person remains a separate permanent identity.
 result:=public.club_commit_import(c,'2099-11-03',false,'replace',jsonb_build_array(row_data||'{"player_id":null,"identity_confirmed":true}'),'other person',gen_random_uuid(),null,true);
 select player_id into other from public.club_snapshot_players where snapshot_id=(result->>'snapshot_id')::uuid;
 perform public.club_manage_alias(c,other,'冷冷月',null);
 begin
   perform public.club_commit_import(c,'2099-11-04',false,'replace',jsonb_build_array(row_data),'ambiguous alias',gen_random_uuid(),null,true);
   raise exception 'Ambiguous alias auto accepted';
 exception when sqlstate 'PT409' then null; end;
 perform public.club_manage_alias(c,null,null,alias_id);
 if exists(select 1 from public.club_player_aliases where id=alias_id and revoked_at is null) then raise exception 'Wrong alias not revoked'; end if;
 -- Even after absence in a complete roster, explicit rejoining uses original UUID.
 perform public.club_commit_import(c,'2099-11-05',true,'replace',jsonb_build_array(row_data||jsonb_build_object('player_id',other,'identity_confirmed',true)),'complete without first',gen_random_uuid(),null,true);
 perform public.club_commit_import(c,'2099-11-06',false,'replace',jsonb_build_array(row_data||'{"identity_confirmed":true,"join_days":0}'),'rejoin',gen_random_uuid(),null,true);
 if (select count(*) from public.club_snapshot_players where player_id=pid)<>3 then raise exception 'Rejoin lost history or identity'; end if;
 begin
   perform public.club_commit_import(c,'2099-11-08',false,'replace',jsonb_build_array(
     row_data||jsonb_build_object('name','冷泠月','identity_confirmed',false),
     row_data||jsonb_build_object('player_id',other,'name','冷冷月','source_name','冷泠月','identity_confirmed',true,'remember_alias',true)
   ),'alias collides with earlier auto row',gen_random_uuid(),null,true);
   raise exception 'New alias silently invalidated earlier auto choice';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.club_commit_import(c,'2099-11-07',false,'replace',jsonb_build_array(row_data||'{"identity_confirmed":true}',row_data||'{"identity_confirmed":true}'),'duplicate identity',gen_random_uuid(),null,true);
   raise exception 'Duplicate identity accepted';
 exception when sqlstate '22023' then null; end;
 begin
   insert into public.club_player_aliases(club_id,player_id,alias_name,confirmed_by) values(c,pid,'injected',auth.uid());
   raise exception 'Direct alias mutation allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin
 if exists(select 1 from public.club_player_aliases) then raise exception 'Unrelated user can read aliases'; end if;
 if has_function_privilege('anon','public.club_manage_alias(uuid,uuid,text,uuid)','execute') then raise exception 'Anonymous alias RPC executable'; end if;
 begin
   perform public.club_manage_alias('ce0c7103-1cdf-4b08-8619-f71d4915f598',null,'unauthorized',null);
   raise exception 'Unrelated user can change aliases';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
