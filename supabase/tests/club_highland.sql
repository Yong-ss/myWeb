-- Disposable PostgreSQL only. Highland Race V1 (docs/CLUB_HIGHLAND_RACE_DISCUSSION.md). Everything rolls back.
-- Why it matters: a highland result is a single match of this club's confirmed players picked out of a faction-wide
-- board. It must never mix with the Four-Way League (data, permissions, attendance), never accept an unconfirmed or
-- foreign identity, never store zero participants or a guessed value, and every correction must be versioned.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- 1 owner X; 2 admin X; 3 admin X; 4 platform admin (admin of Y); 5 alliance leader of X; 6 owner Y; 7 outsider.
insert into auth.users(id,email,email_confirmed_at) select md5('hl-user-'||n)::uuid,'hl-'||n||'@fixture.invalid',now() from generate_series(1,7)n;
insert into public.club_clubs(id,name) select md5('hl-club-'||c)::uuid,'Highland club '||c from unnest(array['x','y'])c;
insert into public.club_memberships(club_id,user_id,role) values
 (md5('hl-club-x')::uuid,md5('hl-user-1')::uuid,'owner'),(md5('hl-club-x')::uuid,md5('hl-user-2')::uuid,'admin'),(md5('hl-club-x')::uuid,md5('hl-user-3')::uuid,'admin'),
 (md5('hl-club-y')::uuid,md5('hl-user-4')::uuid,'admin'),(md5('hl-club-y')::uuid,md5('hl-user-6')::uuid,'owner');
insert into public.platform_role_assignments(user_id,role) values (md5('hl-user-4')::uuid,'platform_admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000af04',md5('hl-user-4')::uuid,'pa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000ac04',md5('hl-user-4')::uuid,'aal2','00000000-0000-4000-8000-00000000af04');
insert into public.club_alliances(id,name) values (md5('hl-alliance')::uuid,'Highland alliance');
insert into public.club_alliance_members(alliance_id,club_id) values (md5('hl-alliance')::uuid,md5('hl-club-x')::uuid);
insert into public.alliance_leaders(alliance_id,user_id) values (md5('hl-alliance')::uuid,md5('hl-user-5')::uuid);
-- Players A..D of X, and one of Y. Rosters: 10-01 A B C; 10-06 A B D (C left: still a player of X, just departed).
insert into public.club_players(id,club_id,display_name,match_name) select md5('hl-player-'||p)::uuid,md5('hl-club-x')::uuid,'Player '||p,'Player'||p from unnest(array['a','b','c','d'])p;
insert into public.club_players(id,club_id,display_name,match_name) values (md5('hl-player-y')::uuid,md5('hl-club-y')::uuid,'Player Y','PlayerY');
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('hl-import-'||d)::uuid,md5('hl-club-x')::uuid,md5('hl-user-1')::uuid,'{}',1,md5('hl-req-'||d)::uuid from unnest(array['01','06'])d;
insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
 select md5('hl-snap-'||d)::uuid,md5('hl-club-x')::uuid,('2026-10-'||d)::date,1,md5('hl-import-'||d)::uuid,true from unnest(array['01','06'])d;
insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name)
 select md5('hl-club-x')::uuid,md5('hl-snap-'||d)::uuid,md5('hl-player-'||p)::uuid,'Player '||p from (values ('01','a'),('01','b'),('01','c'),('06','a'),('06','b'),('06','d')) v(d,p);

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('hl-user-'||n)::uuid $$;
create function pg_temp.c(x text) returns uuid language sql as $$ select md5('hl-club-'||x)::uuid $$;
create function pg_temp.p(x text) returns uuid language sql as $$ select md5('hl-player-'||x)::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('hl-user-'||n)::text,true),set_config('request.jwt.claims','{"aal":"aal1"}',true) $$;
create function pg_temp.as_pa() returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('hl-user-4')::text,true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ac04"}',true) $$;
create function pg_temp.perms(n int,x text,prefix text) returns text[] language plpgsql as $$ begin perform pg_temp.as_user(n); return array(select k from unnest(public.club_my_permissions(pg_temp.c(x))) k where k like prefix||'.%'); end $$;
create function pg_temp.refused(sql text,code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then if sqlstate<>code then raise exception '% failed with % (%), expected %',sql,sqlstate,sqlerrm,code; end if; return; end;
 raise exception '% was allowed',sql;
end $$;
create function pg_temp.count_of(t text) returns bigint language plpgsql security definer as $$ declare n bigint; begin execute format('select count(*) from public.%I',t) into n; return n; end $$;
-- A participant with all nine highland metrics.
create function pg_temp.row(player uuid,kills int,merit int default 2000) returns jsonb language sql as $$
 select jsonb_build_object('player_id',player,'output_name','AI名','strategy_name','AI名','kills',kills,'assists',1,'dispersals',0,'awakens',0,'merit',merit,
  'player_damage',17080000,'damage_taken',4627000,'healing',0,'purification',0) $$;
create function pg_temp.zero(player uuid) returns jsonb language sql as $$
 select jsonb_build_object('player_id',player,'output_name','零','strategy_name','零','kills',0,'assists',0,'dispersals',0,'awakens',0,'merit',0,'player_damage',0,'damage_taken',0,'healing',0,'purification',0) $$;
create function pg_temp.src() returns jsonb language sql as $$ select '{"output_rows":120,"strategy_rows":118,"excluded_rows":110}'::jsonb $$;
create function pg_temp.fw_row(player uuid) returns jsonb language sql as $$
 select jsonb_build_object('player_id',player,'name',null,'output_name',null,'strategy_name',null,'kills',1,'assists',0,'dispersals',0,'awakens',0,'player_damage',0,'damage_taken',0,'healing',0,'guardian_damage',0,'purification',0) $$;
create function pg_temp.fw_raw() returns text language sql as $$ select '{"schema_version":1,"event_type":"four_way_league","output":[{"player_name":"x"}],"strategy":[{"player_name":"x"}]}' $$;
set local role authenticated;

-- 1. Defaults equal the Four-Way League ones; the two sets are independent in both directions.
do $$ begin
 if pg_temp.perms(1,'x','highland')<>array['highland.edit','highland.import','highland.read'] or pg_temp.perms(2,'x','highland')<>array['highland.edit','highland.import','highland.read'] then raise exception 'Default highland permissions wrong'; end if;
 if pg_temp.perms(5,'x','highland')<>array['highland.read'] or pg_temp.perms(7,'x','highland')<>'{}' or pg_temp.perms(6,'x','highland')<>'{}' then raise exception 'Highland read leaks'; end if;
 -- The owner denies admin 2 every Four-Way League permission: highland stays; then the reverse.
 perform pg_temp.as_user(1);
 perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.read',false);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',false);
 if pg_temp.perms(2,'x','highland')<>array['highland.edit','highland.import','highland.read'] or pg_temp.perms(2,'x','events')<>'{}' then raise exception 'Four-way deny reached highland'; end if;
 perform pg_temp.as_user(1);
 perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.read',null);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',null);
 perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'highland.read',false);
 -- Highland import/edit need highland.read (and the explanation says so); four-way untouched.
 if pg_temp.perms(2,'x','highland')<>'{}' or pg_temp.perms(2,'x','events')<>array['events.edit','events.import','events.read'] then raise exception 'Highland read dependency wrong'; end if;
 perform pg_temp.as_user(1);
 if (select x->>'layer' from jsonb_array_elements(public.club_team_permissions(pg_temp.c('x'))->'admins') a, jsonb_array_elements(a->'explain'->'permissions') x where (a->>'user_id')::uuid=pg_temp.u(2) and x->>'key'='highland.edit')<>'needs_read' then raise exception 'Explanation misses highland read'; end if;
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_highland_list(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.refused(format($q$select public.club_highland_identities(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'highland.read',null);
end $$;

-- 2. Platform layer: its own permission and functions; neither function family accepts the other's keys.
do $$ begin
 perform pg_temp.as_user(4);perform pg_temp.refused(format($q$select public.platform_highland_permissions(%L)$q$,pg_temp.c('x')),'42501'); -- no MFA
 perform pg_temp.as_pa();
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,'admin',null,'highland.edit',false)$q$,pg_temp.c('x')),'22023');
 perform pg_temp.refused(format($q$select public.platform_set_highland_permission(%L,'admin',null,'events.edit',false)$q$,pg_temp.c('x')),'22023');
 perform public.platform_set_highland_permission(pg_temp.c('x'),'admin',null,'highland.edit',false);
 if pg_temp.perms(2,'x','highland')<>array['highland.import','highland.read'] or pg_temp.perms(2,'x','events')<>array['events.edit','events.import','events.read'] then raise exception 'Platform highland role deny wrong'; end if;
 perform pg_temp.as_pa();perform public.platform_set_highland_permission(pg_temp.c('x'),null,pg_temp.u(3),'highland.edit',true);
 if pg_temp.perms(3,'x','highland')<>array['highland.edit','highland.import','highland.read'] then raise exception 'Personal highland exception wrong'; end if;
 -- A four-way platform deny for the admin role leaves highland as it is.
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('x'),'admin',null,'events.read',false);
 if pg_temp.perms(3,'x','highland')<>array['highland.edit','highland.import','highland.read'] or pg_temp.perms(3,'x','events')<>'{}' then raise exception 'Four-way platform deny reached highland'; end if;
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('x'),'admin',null,'events.read',null);
 perform public.platform_set_highland_permission(pg_temp.c('x'),null,pg_temp.u(3),'highland.edit',null);
 perform public.platform_set_highland_permission(pg_temp.c('x'),'admin',null,'highland.edit',null);
 -- No self-promotion.
 perform pg_temp.refused(format($q$select public.platform_set_highland_permission(%L,'admin',null,'highland.edit',true)$q$,pg_temp.c('y')),'42501');
 if jsonb_array_length(public.platform_highland_permissions(pg_temp.c('x'))->'permissions')<>3
   or (public.platform_highland_permissions(pg_temp.c('x'))->'permissions')::text like '%events.%' then raise exception 'Platform highland reader lists wrong permissions'; end if;
 if pg_temp.perms(2,'x','highland')<>array['highland.edit','highland.import','highland.read'] then raise exception 'Highland defaults not restored'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.club_audit_events where action='highland_permission_changed')<>4 then raise exception 'Platform highland changes not logged'; end if;
end $$;
set local role authenticated;

-- 3. Create: one valid highland per club and date (independent of the Four-Way League), at least one confirmed player
-- of this club, every value present, faction and rank optional but fixed, retries saved once.
do $$ declare x uuid:=pg_temp.c('x'); r uuid:=gen_random_uuid(); first jsonb; fw jsonb; aliases bigint; fwr uuid:=gen_random_uuid(); begin
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,'[]',%L,gen_random_uuid())$q$,x,pg_temp.src()),'22023'); -- zero participants
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,%L,100,null,null,%L,%L,gen_random_uuid())$q$,x,current_date+2,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)),pg_temp.src()),'22023'); -- future
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)-'merit'),pg_temp.src()),'22023'); -- half a row
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)||'{"healing":null}'),pg_temp.src()),'22023'); -- null is not 0
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)||'{"guardian_damage":0}'),pg_temp.src()),'22023'); -- no guardian damage
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(null,3)),pg_temp.src()),'22023'); -- never a new identity
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('y'),3)),pg_temp.src()),'42501'); -- other club's player
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3),pg_temp.row(pg_temp.p('a'),4)),pg_temp.src()),'PT409'); -- same player twice
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,'某势力',null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)),pg_temp.src()),'22023'); -- unknown faction
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,5,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)),pg_temp.src()),'22023'); -- rank 5
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,0,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3)),pg_temp.src()),'22023'); -- rank 0
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,'{"output_rows":1}',gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3))),'22023'); -- bad source counts
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,'{"output_rows":"x","strategy_rows":1,"excluded_rows":1}',gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),3))),'22023');
 -- An alias with no aliases.manage rolls the whole create back.
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(x,pg_temp.u(2),'aliases.manage',false);perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',100,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('b'),1),pg_temp.row(pg_temp.p('a'),3)||'{"output_name":"Player a丶","remember_alias":true}'),pg_temp.src()),'42501');
 if pg_temp.count_of('club_events')<>0 or pg_temp.count_of('club_highland_event_players')<>0 then raise exception 'Failed create left rows behind'; end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(x,pg_temp.u(2),'aliases.manage',null);perform pg_temp.as_user(2);
 -- A Four-Way League on the same day first: both may exist.
 fw:=public.club_event_create(x,'2026-10-04',500,jsonb_build_array(pg_temp.fw_row(pg_temp.p('a'))),pg_temp.fw_raw(),fwr);
 -- Success: A (remembered misspelling), the all-zero B (still a participant), the departed C (manual history link),
 -- faction and rank left empty. Retry returns the same event; the same id with other content is refused.
 aliases:=pg_temp.count_of('club_player_aliases');
 first:=public.club_highland_create(x,'2026-10-04',3000,null,null,jsonb_build_array(pg_temp.row(pg_temp.p('a'),9)||'{"output_name":"Player a丶","remember_alias":true}',pg_temp.zero(pg_temp.p('b')),pg_temp.row(pg_temp.p('c'),1)),pg_temp.src(),r);
 if (public.club_highland_create(x,'2026-10-04',3000,null,null,jsonb_build_array(pg_temp.row(pg_temp.p('a'),9)||'{"output_name":"Player a丶","remember_alias":true}',pg_temp.zero(pg_temp.p('b')),pg_temp.row(pg_temp.p('c'),1)),pg_temp.src(),r)->>'replayed')<>'true' then raise exception 'Retry not replayed'; end if;
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',1,null,null,%L,%L,%L)$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),9)),pg_temp.src(),r),'22023');
 -- A Four-Way League request id cannot be reused for highland content either (one request id space per club).
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',1,null,null,%L,%L,%L)$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),9)),pg_temp.src(),
   fwr),'22023');
 perform pg_temp.refused(format($q$select public.club_highland_create(%L,'2026-10-04',1,null,null,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('d'),9)),pg_temp.src()),'PT409'); -- same date
 if pg_temp.count_of('club_events')<>2 or pg_temp.count_of('club_highland_event_players')<>3 or pg_temp.count_of('club_player_aliases')<>aliases+2 then raise exception 'Create stored wrong rows: % % % %',pg_temp.count_of('club_events'),pg_temp.count_of('club_highland_event_players'),pg_temp.count_of('club_player_aliases'),aliases; end if;
 if (public.club_highland_detail(x,(first->>'event_id')::uuid)->'event'->>'total_kills')::int<>10 or (public.club_highland_detail(x,(first->>'event_id')::uuid)->'event'->>'total_merit')::int<>4000
   or public.club_highland_detail(x,(first->>'event_id')::uuid)->'event'->'faction'<>'null'::jsonb then raise exception 'Highland detail wrong'; end if;
 if (select p->>'merit' from jsonb_array_elements(public.club_highland_detail(x,(first->>'event_id')::uuid)->'players') p where (p->>'player_id')::uuid=pg_temp.p('b'))<>'0' then raise exception 'All-zero participant lost'; end if;
 -- With a faction and rank (both, then only a rank) on other days.
 perform public.club_highland_create(x,'2026-10-05',10,'血皇帝势力',2,jsonb_build_array(pg_temp.row(pg_temp.p('a'),1)),pg_temp.src(),gen_random_uuid());
 perform public.club_highland_create(x,'2026-10-07',10,null,4,jsonb_build_array(pg_temp.row(pg_temp.p('b'),1)),pg_temp.src(),gen_random_uuid());
end $$;
reset role;
-- The log has counts only: no external player name or number ever reaches the database.
do $$ begin
 if (select details - 'actor_role' - 'actor_email' from public.club_audit_events where action='highland_created' and details->>'date'='2026-10-04')
   <>'{"date":"2026-10-04","faction":null,"total_score":3000,"faction_rank":null,"participants":3,"reported_source":{"output_rows":120,"strategy_rows":118,"excluded_rows":110}}'::jsonb then raise exception 'Create audit wrong: %',(select jsonb_agg(details) from public.club_audit_events where action='highland_created'); end if;
 -- Type consistency is enforced by the database itself, not only by the functions.
 begin insert into public.club_event_players(club_id,event_id,player_id,origin,kills,assists,dispersals,awakens,player_damage,damage_taken,healing,guardian_damage,purification)
   select club_id,id,md5('hl-player-d')::uuid,'manual',0,0,0,0,0,0,0,0,0 from public.club_events where event_type='highland_race' limit 1;
   raise exception 'Four-way row joined a highland event'; exception when sqlstate '22023' then null; end;
 begin insert into public.club_highland_event_players(club_id,event_id,player_id,origin,kills,assists,dispersals,awakens,merit,player_damage,damage_taken,healing,purification)
   select club_id,id,md5('hl-player-d')::uuid,'manual',0,0,0,0,0,0,0,0,0 from public.club_events where event_type='four_way_league' limit 1;
   raise exception 'Highland row joined a four-way event'; exception when foreign_key_violation then null; end;
 begin update public.club_events set event_type='four_way_league' where event_type='highland_race'; raise exception 'Event type changed'; exception when sqlstate '22023' then null; end;
 begin update public.club_events set faction='血皇帝势力' where event_type='four_way_league'; raise exception 'Four-way event got a faction'; exception when check_violation then null; end;
 begin update public.club_events set faction='臆造势力' where event_type='highland_race'; raise exception 'Unknown faction stored'; exception when check_violation then null; end;
end $$;
set local role authenticated;

-- 4. Isolation: the Four-Way League functions never answer for a highland event and the reverse.
do $$ declare x uuid:=pg_temp.c('x'); h uuid; f uuid; begin
 perform pg_temp.as_user(1);
 h:=(select (e->>'id')::uuid from jsonb_array_elements(public.club_highland_list(x)->'events') e where e->>'event_date'='2026-10-04');
 f:=(public.club_events_list(x)->'events'->0->>'id')::uuid;
 if jsonb_array_length(public.club_events_list(x)->'events')<>1 or jsonb_array_length(public.club_highland_list(x)->'events')<>3 then raise exception 'Lists mix event types'; end if;
 if public.club_event_detail(x,h) is not null or public.club_highland_detail(x,f) is not null then raise exception 'Detail answers for the other type'; end if;
 if public.club_event_version(x,h,1) is not null or public.club_highland_version(x,f,1) is not null then raise exception 'Version answers for the other type'; end if;
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,1,'void','{}',gen_random_uuid())$q$,x,h),'22023');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,1,'void','{}',gen_random_uuid())$q$,x,f),'22023');
 -- Four-way attendance: A attended the four-way only (one event); highland attendance counts highland only.
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('a'))->'attended')<>1 or jsonb_array_length(public.club_player_highland(x,pg_temp.p('a'))->'attended')<>2 then raise exception 'Attendance mixes types'; end if;
 if public.club_player_events(x,pg_temp.p('a'))->'attended'->0 ? 'merit' or not (public.club_player_highland(x,pg_temp.p('a'))->'attended'->0 ? 'merit') then raise exception 'Attendance metrics mixed'; end if;
 -- Highland events need highland.read: an admin without it reads the four-way but not highland.
 perform public.club_set_admin_permission(x,pg_temp.u(3),'highland.read',false);
 perform pg_temp.as_user(3);
 perform pg_temp.refused(format($q$select public.club_highland_detail(%L,%L)$q$,x,h),'42501');
 perform pg_temp.refused(format($q$select public.club_player_highland(%L,%L)$q$,x,pg_temp.p('a')),'42501');
 if public.club_event_detail(x,f) is null then raise exception 'Four-way lost with highland denied'; end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(x,pg_temp.u(3),'highland.read',null);
 -- Other club: nothing.
 perform pg_temp.as_user(6);perform pg_temp.refused(format($q$select public.club_highland_detail(%L,%L)$q$,x,h),'42501');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,1,'void','{}',gen_random_uuid())$q$,pg_temp.c('y'),h),'22023');
 -- The alliance leader reads, never writes or reads names for matching.
 perform pg_temp.as_user(5);
 if jsonb_array_length(public.club_highland_detail(x,h)->'players')<>3 then raise exception 'Leader cannot read'; end if;
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,1,'void','{}',gen_random_uuid())$q$,x,h),'42501');
 perform pg_temp.refused(format($q$select public.club_highland_identities(%L)$q$,x),'42501');
end $$;

-- 5. Identities: every player (departed ones too), current = in the latest roster, aliases.
do $$ declare r jsonb; begin
 perform pg_temp.as_user(2);
 r:=public.club_highland_identities(pg_temp.c('x'));
 if (select array_agg(p->>'display_name' order by p->>'display_name') from jsonb_array_elements(r->'players') p where (p->>'current')::boolean)<>array['Player a','Player b','Player d']
   or (select p->>'current' from jsonb_array_elements(r->'players') p where p->>'display_name'='Player c')<>'false' then raise exception 'Current flags wrong: %',r; end if;
 if r->>'roster_date'<>'2026-10-06' or (r->>'truncated')::boolean or jsonb_array_length(r->'aliases')<>2 then raise exception 'Identity context wrong: %',r; end if;
 if r::text like '%Player Y%' then raise exception 'Another club''s player listed'; end if;
end $$;

-- 6. Corrections: faction/rank (fill, change, clear), metrics, rebind, add, remove, date, void/restore, versions.
do $$ declare x uuid:=pg_temp.c('x'); h uuid; d jsonb; begin
 perform pg_temp.as_user(2);
 h:=(select (e->>'id')::uuid from jsonb_array_elements(public.club_highland_list(x)->'events') e where e->>'event_date'='2026-10-04');
 perform public.club_highland_update(x,h,1,'faction','{"faction":"血皇帝势力","faction_rank":null}',gen_random_uuid());
 perform public.club_highland_update(x,h,2,'faction','{"faction":"血皇帝势力","faction_rank":1}',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,3,'faction','{"faction":"血皇帝势力","faction_rank":1}',gen_random_uuid())$q$,x,h),'22023'); -- no change
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,3,'faction','{"faction":"臆造","faction_rank":1}',gen_random_uuid())$q$,x,h),'22023');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,3,'faction','{"faction":null,"faction_rank":"1"}',gen_random_uuid())$q$,x,h),'22023'); -- a string is not a rank
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,3,'faction','{"faction":null,"faction_rank":1.5}',gen_random_uuid())$q$,x,h),'22023');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,3,'faction','{"faction":null}',gen_random_uuid())$q$,x,h),'22023'); -- both keys required
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,2,'score','{"total_score":1}',gen_random_uuid())$q$,x,h),'PT409'); -- stale version
 perform public.club_highland_update(x,h,3,'faction','{"faction":null,"faction_rank":3}',gen_random_uuid());
 perform public.club_highland_update(x,h,4,'score','{"total_score":3100}',gen_random_uuid());
 perform public.club_highland_update(x,h,5,'metrics',pg_temp.row(pg_temp.p('a'),12,2500)-'output_name'-'strategy_name',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,6,'metrics',%L,gen_random_uuid())$q$,x,h,pg_temp.row(pg_temp.p('a'),12,2500)-'output_name'-'strategy_name'),'22023'); -- no change
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,6,'metrics',%L,gen_random_uuid())$q$,x,h,pg_temp.row(pg_temp.p('a'),12)-'output_name'-'strategy_name'-'merit'),'22023'); -- merit missing
 -- Rebind C (departed) -> D; onto someone already in the event is refused; to a new identity is impossible.
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,6,'rebind',%L,gen_random_uuid())$q$,x,h,jsonb_build_object('from_player',pg_temp.p('c'),'to_player',pg_temp.p('a'))),'PT409');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,6,'rebind',%L,gen_random_uuid())$q$,x,h,jsonb_build_object('from_player',pg_temp.p('c'),'to_player',null)),'22023');
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,6,'rebind',%L,gen_random_uuid())$q$,x,h,jsonb_build_object('from_player',pg_temp.p('c'),'to_player',pg_temp.p('y'))),'42501');
 perform public.club_highland_update(x,h,6,'rebind',jsonb_build_object('from_player',pg_temp.p('c'),'to_player',pg_temp.p('d')),gen_random_uuid());
 -- Add C back manually (history link), then remove D.
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,7,'add',%L,gen_random_uuid())$q$,x,h,pg_temp.row(pg_temp.p('a'),1)-'output_name'-'strategy_name'),'PT409');
 -- A manual addition carries no read names (they would reach the log unchecked).
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,7,'add',%L,gen_random_uuid())$q$,x,h,pg_temp.row(pg_temp.p('c'),2)),'22023');
 perform public.club_highland_update(x,h,7,'add',pg_temp.row(pg_temp.p('c'),2)-'output_name'-'strategy_name',gen_random_uuid());
 perform public.club_highland_update(x,h,8,'remove',jsonb_build_object('player_id',pg_temp.p('d')),gen_random_uuid());
 d:=public.club_highland_detail(x,h);
 if (d->'event'->>'version')::int<>9 or jsonb_array_length(d->'versions')<>9 or jsonb_array_length(d->'players')<>3 or d->'event'->>'faction' is not null or (d->'event'->>'faction_rank')::int<>3
   or (d->'event'->>'total_kills')::int<>14 then raise exception 'Corrections stored wrong: %',d->'event'; end if;
 if (select p->>'origin' from jsonb_array_elements(d->'players') p where (p->>'player_id')::uuid=pg_temp.p('c'))<>'manual' then raise exception 'Manual add not marked'; end if;
 -- Versions replay each state, including faction history.
 if public.club_highland_version(x,h,1)->'state'->>'faction' is not null or public.club_highland_version(x,h,3)->'state'->>'faction'<>'血皇帝势力'
   or (public.club_highland_version(x,h,3)->'state'->>'faction_rank')::int<>1 or (public.club_highland_version(x,h,4)->'state'->>'faction_rank')::int<>3 then raise exception 'Faction history wrong'; end if;
 if (public.club_highland_version(x,h,1)->'state'->'players')::text not like '%"merit": 2000%' or (public.club_highland_version(x,h,1)->'state'->'players')::text like '%event_type%' then raise exception 'Version state wrong'; end if;
 -- Never down to zero participants: remove until one is left, the last is refused.
 perform public.club_highland_update(x,h,9,'remove',jsonb_build_object('player_id',pg_temp.p('b')),gen_random_uuid());
 perform public.club_highland_update(x,h,10,'remove',jsonb_build_object('player_id',pg_temp.p('c')),gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,11,'remove',%L,gen_random_uuid())$q$,x,h,jsonb_build_object('player_id',pg_temp.p('a'))),'PT409');
 -- Date: onto another valid highland day refused; onto a four-way day fine (other type); void frees the date.
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,11,'date','{"event_date":"2026-10-05"}',gen_random_uuid())$q$,x,h),'PT409');
 perform public.club_highland_update(x,h,11,'date','{"event_date":"2026-10-03"}',gen_random_uuid());
 perform public.club_highland_update(x,h,12,'void','{}',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,13,'score','{"total_score":1}',gen_random_uuid())$q$,x,h),'PT409');
 perform public.club_highland_create(x,'2026-10-03',1,null,null,jsonb_build_array(pg_temp.row(pg_temp.p('b'),1)),pg_temp.src(),gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,13,'restore','{}',gen_random_uuid())$q$,x,h),'PT409');
 if jsonb_array_length(public.club_highland_list(x,true)->'events')<>1 or jsonb_array_length(public.club_events_list(x,true)->'events')<>0 then raise exception 'Voided lists wrong'; end if;
end $$;
reset role;
do $$ begin
 if (select details->'added' ? 'output_name' from public.club_audit_events where action='highland_add') then raise exception 'Add logged a read name'; end if;
 if (select count(*) from public.club_audit_events where action like 'highland\_%' and action<>'highland_permission_changed')<>16 then raise exception 'Highland writes not all logged: %',(select count(*) from public.club_audit_events where action like 'highland\_%'); end if;
end $$;
set local role authenticated;

-- 7. Attendance (valid highland events now 10-03 with B, 10-05 with A, 10-07 with B). Rosters 10-01 A B C and 10-06 A B D.
-- A: present 10-01 and 10-06, not in 10-03 -> absent there; 10-07 after the last roster -> uncertain, not absent.
-- C: left (complete roster 10-06 without them) -> never absent; before that roster the days are unprovable (uncertain). D: first seen 10-06 -> not absent before; 10-07 uncertain.
do $$ declare x uuid:=pg_temp.c('x'); r jsonb; begin
 perform pg_temp.as_user(5);
 r:=public.club_player_highland(x,pg_temp.p('a'));
 if jsonb_array_length(r->'attended')<>1 or r->'absent'->0->>'event_date'<>'2026-10-03' or jsonb_array_length(r->'absent')<>1 or (r->>'uncertain')::int<>1 then raise exception 'A highland attendance wrong: %',r; end if;
 if jsonb_array_length(public.club_player_highland(x,pg_temp.p('c'))->'absent')<>0 or (public.club_player_highland(x,pg_temp.p('c'))->>'uncertain')::int<>2 then raise exception 'Departed C counted'; end if;
 if jsonb_array_length(public.club_player_highland(x,pg_temp.p('d'))->'absent')<>0 then raise exception 'D counted before joining'; end if;
 if public.club_player_highland(x,pg_temp.p('y')) is not null then raise exception 'Another club''s player answered'; end if;
 -- The Four-Way League attendance is unchanged by any of this (A attended its only event).
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('a'))->'absent')<>0 or jsonb_array_length(public.club_player_events(x,pg_temp.p('a'))->'attended')<>1 then raise exception 'Four-way attendance changed'; end if;
end $$;

-- 8. Clients never touch the highland table directly.
do $$ begin perform pg_temp.refused('select * from public.club_highland_event_players','42501'); end $$;
