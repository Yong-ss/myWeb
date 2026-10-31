-- Disposable fixture only; never run on hosted Supabase.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000f011','d0ddb226-a10a-471c-be4b-d5e5153bd313','counts fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000c011','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f011');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f011');
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c011"}',true);

-- Assert exact mutually exclusive counts, and preserve every historical identity throughout corrections/deletion.
create function pg_temp.check_counts(c uuid, expected jsonb) returns void language plpgsql as $$
declare row jsonb;
begin
 select value into row from jsonb_array_elements(public.platform_overview()->'clubs') where value->>'id'=c::text;
 if row->'player_counts' is distinct from expected or (row->>'players')::int<>6 then
   raise exception 'Counts wrong: expected %, got %',expected,row;
 end if;
end $$;
do $$
declare c uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); p uuid[]; s uuid[]; imp uuid; i int; item jsonb;
begin
 insert into public.club_clubs(id,name) values(c,'Counts A'),(b,'Counts B');
 select array_agg(gen_random_uuid()) into p from generate_series(1,6);
 select array_agg(gen_random_uuid()) into s from generate_series(1,5);
 insert into public.club_players(id,club_id,display_name) select id,c,'Counts player' from unnest(p) id;
 perform pg_temp.check_counts(c,'null'); -- no latest valid record: unknown, not zeros
 for i in 1..5 loop
   imp:=gen_random_uuid();
   insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
     values(imp,c,auth.uid(),'fixture',1,gen_random_uuid());
   insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster,is_current,supersedes_id)
     values(s[i],c,date '2001-01-01'+least(i-1,3),case when i=5 then 2 else 1 end,imp,i=3,i<>5,case when i=5 then s[4] else null end);
   if i=1 then
     insert into public.club_snapshot_players(club_id,snapshot_id,player_id) select c,s[i],id from unnest(p) id;
     perform pg_temp.check_counts(c,'{"present":6,"temporary":0,"confirmed_left":0,"unconfirmed":0,"other_left":0}');
   else
     insert into public.club_snapshot_players(club_id,snapshot_id,player_id) values(c,s[i],p[1]);
   end if;
   if i=2 then
     insert into public.club_snapshot_absences(club_id,snapshot_id,player_id,decision,reason) values
       (c,s[i],p[2],'left',null),(c,s[i],p[3],'temporary','休息'),(c,s[i],p[4],'uncertain',null),(c,s[i],p[5],'missed',null);
     perform pg_temp.check_counts(c,'{"present":1,"temporary":1,"confirmed_left":1,"unconfirmed":3,"other_left":0}');
   elsif i=3 then
     perform pg_temp.check_counts(c,'{"present":1,"temporary":1,"confirmed_left":1,"unconfirmed":2,"other_left":1}');
   elsif i=4 then
     insert into public.club_snapshot_players(club_id,snapshot_id,player_id) values(c,s[i],p[2]);
     perform pg_temp.check_counts(c,'{"present":2,"temporary":1,"confirmed_left":0,"unconfirmed":2,"other_left":1}');
   elsif i=5 then
     insert into public.club_snapshot_players(club_id,snapshot_id,player_id) values(c,s[i],p[3]);
     update public.club_snapshots set is_current=false where id=s[4];
     update public.club_snapshots set is_current=true where id=s[5];
     perform pg_temp.check_counts(c,'{"present":2,"temporary":0,"confirmed_left":1,"unconfirmed":2,"other_left":1}');
   end if;
 end loop;
 -- Removing every revision of the latest date restores day 3, not a hidden revision.
 update public.club_snapshots set deleted_at=now() where club_id=c and snapshot_date='2001-01-04';
 perform pg_temp.check_counts(c,'{"present":1,"temporary":1,"confirmed_left":1,"unconfirmed":2,"other_left":1}');
 -- Removed observations cannot prove absence or presence; identities remain in history and become unknown.
 update public.club_snapshots set deleted_at=now() where id=s[1];
 perform pg_temp.check_counts(c,'{"present":1,"temporary":0,"confirmed_left":0,"unconfirmed":5,"other_left":0}');
 update public.club_snapshots set deleted_at=now() where club_id=c;
 perform pg_temp.check_counts(c,'null');
 -- A real empty effective snapshot can report zero present, while missing observations remain unknown.
 update public.club_snapshots set deleted_at=null where id=s[3];
 delete from public.club_snapshot_players where snapshot_id=s[3];
 perform pg_temp.check_counts(c,'{"present":0,"temporary":0,"confirmed_left":0,"unconfirmed":6,"other_left":0}');
 select value into item from jsonb_array_elements(public.platform_overview()->'clubs') where value->>'id'=b::text;
 if item->'player_counts'<>'null'::jsonb or item->>'players'<>'0' then raise exception 'Club isolation failed: %',item; end if;
end $$;
