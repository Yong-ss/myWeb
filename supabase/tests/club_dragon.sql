-- Disposable PostgreSQL only. Dragon Hunt V1 (attendance only). Everything rolls back.
-- Why it matters: a member's dragon attendance and absence counts come only from these rows. A hunt must never mix
-- with the other event types (data, permissions, attendance), never credit a player of another club or a guessed
-- identity, never be saved twice for one day, and a voided hunt must stop counting and free its date.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- 1 owner X; 2 admin X; 3 alliance leader of X; 4 owner Y; 5 outsider.
insert into auth.users(id,email,email_confirmed_at) select md5('dh-user-'||n)::uuid,'dh-'||n||'@fixture.invalid',now() from generate_series(1,5)n;
insert into public.club_clubs(id,name) select md5('dh-club-'||c)::uuid,'Dragon club '||c from unnest(array['x','y'])c;
insert into public.club_memberships(club_id,user_id,role) values
 (md5('dh-club-x')::uuid,md5('dh-user-1')::uuid,'owner'),(md5('dh-club-x')::uuid,md5('dh-user-2')::uuid,'admin'),(md5('dh-club-y')::uuid,md5('dh-user-4')::uuid,'owner');
insert into public.club_alliances(id,name) values (md5('dh-alliance')::uuid,'Dragon alliance');
insert into public.club_alliance_members(alliance_id,club_id) values (md5('dh-alliance')::uuid,md5('dh-club-x')::uuid);
insert into public.alliance_leaders(alliance_id,user_id) values (md5('dh-alliance')::uuid,md5('dh-user-3')::uuid);
-- Players A B of X (both in the 10-01 and 10-06 rosters), one of Y.
insert into public.club_players(id,club_id,display_name,match_name) select md5('dh-player-'||p)::uuid,md5('dh-club-x')::uuid,'Player '||p,'Player'||p from unnest(array['a','b'])p;
insert into public.club_players(id,club_id,display_name,match_name) values (md5('dh-player-y')::uuid,md5('dh-club-y')::uuid,'Player Y','PlayerY');
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('dh-import-'||d)::uuid,md5('dh-club-x')::uuid,md5('dh-user-1')::uuid,'{}',1,md5('dh-req-'||d)::uuid from unnest(array['01','06'])d;
insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
 select md5('dh-snap-'||d)::uuid,md5('dh-club-x')::uuid,('2026-10-'||d)::date,1,md5('dh-import-'||d)::uuid,true from unnest(array['01','06'])d;
insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name)
 select md5('dh-club-x')::uuid,md5('dh-snap-'||d)::uuid,md5('dh-player-'||p)::uuid,'Player '||p from (values ('01','a'),('01','b'),('06','a'),('06','b')) v(d,p);

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('dh-user-'||n)::uuid $$;
create function pg_temp.c(x text) returns uuid language sql as $$ select md5('dh-club-'||x)::uuid $$;
create function pg_temp.p(x text) returns uuid language sql as $$ select md5('dh-player-'||x)::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('dh-user-'||n)::text,true),set_config('request.jwt.claims','{"aal":"aal1"}',true) $$;
create function pg_temp.perms(n int,x text) returns text[] language plpgsql as $$ begin perform pg_temp.as_user(n); return array(select k from unnest(public.club_my_permissions(pg_temp.c(x))) k where k like 'dragon.%'); end $$;
create function pg_temp.refused(sql text,code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then if sqlstate<>code then raise exception '% failed with % (%), expected %',sql,sqlstate,sqlerrm,code; end if; return; end;
 raise exception '% was allowed',sql;
end $$;
create function pg_temp.rows(variadic ids uuid[]) returns jsonb language sql as $$ select jsonb_agg(jsonb_build_object('player_id',i,'read_name','AI名')) from unnest(ids) i $$;
create function pg_temp.create(d text,players jsonb,req text) returns jsonb language sql as $$ select public.club_dragon_create(pg_temp.c('x'),d::date,players,0,md5('dh-r-'||req)::uuid) $$;
set local role authenticated;

do $$ declare e uuid; a jsonb; begin
 -- 1. Defaults: owner/admin all three, alliance leader read only, others nothing; highland grants never open dragon.
 if pg_temp.perms(1,'x')<>array['dragon.edit','dragon.import','dragon.read'] or pg_temp.perms(2,'x')<>array['dragon.edit','dragon.import','dragon.read'] then raise exception 'Default dragon permissions wrong'; end if;
 if pg_temp.perms(3,'x')<>array['dragon.read'] or pg_temp.perms(4,'x')<>'{}' or pg_temp.perms(5,'x')<>'{}' then raise exception 'Dragon read leaks'; end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'dragon.read',false);
 if pg_temp.perms(2,'x')<>'{}' then raise exception 'Dragon import/edit must need dragon.read'; end if;
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_dragon_identities(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('a')),'deny')$q$,'42501');
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'dragon.read',null);
 perform pg_temp.as_user(4);perform pg_temp.refused(format($q$select public.club_dragon_list(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.as_user(3);perform pg_temp.refused($q$select pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('a')),'leader')$q$,'42501');

 -- 2. Create: only this club's players, at least one, no duplicates, no future date; a retry is saved once.
 perform pg_temp.as_user(2);
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('y')),'foreign')$q$,'42501');
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03','[]'::jsonb,'empty')$q$,'22023');
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('a'),pg_temp.p('a')),'dup')$q$,'PT409');
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03','[{"player_id":"x","name":"new"}]'::jsonb,'new')$q$,'22023');
 perform pg_temp.refused($q$select pg_temp.create((current_date+2)::text,pg_temp.rows(pg_temp.p('a')),'future')$q$,'22023');
 e:=(pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('a')),'ok')->>'event_id')::uuid;
 if (pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('a')),'ok')->>'replayed')<>'true' then raise exception 'Retry not replayed'; end if;
 perform pg_temp.refused($q$select pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('b')),'second')$q$,'PT409');
 -- A hunt on the same day as another event type is fine; its rows never enter that type.
 if jsonb_array_length(public.club_dragon_list(pg_temp.c('x'))->'events')<>1 then raise exception 'List wrong'; end if;
 perform pg_temp.refused(format($q$select public.club_highland_update(%L,%L,1,'void','{}'::jsonb,gen_random_uuid())$q$,pg_temp.c('x'),e),'22023');
 if public.club_highland_detail(pg_temp.c('x'),e) is not null or public.club_event_detail(pg_temp.c('x'),e) is not null then raise exception 'Hunt visible as another type'; end if;

 -- 3. Attendance: A attended, B absent (in both surrounding rosters); four-way/highland counts unaffected.
 a:=public.club_player_dragon(pg_temp.c('x'),pg_temp.p('a'));
 if jsonb_array_length(a->'attended')<>1 or jsonb_array_length(a->'absent')<>0 then raise exception 'A attendance wrong: %',a; end if;
 a:=public.club_player_dragon(pg_temp.c('x'),pg_temp.p('b'));
 if jsonb_array_length(a->'attended')<>0 or jsonb_array_length(a->'absent')<>1 then raise exception 'B absence wrong: %',a; end if;
 if jsonb_array_length(public.club_player_highland(pg_temp.c('x'),pg_temp.p('a'))->'attended')<>0 then raise exception 'Hunt counted as highland'; end if;
 perform pg_temp.as_user(3);
 if jsonb_array_length(public.club_player_dragon(pg_temp.c('x'),pg_temp.p('a'))->'attended')<>1 then raise exception 'Alliance leader cannot read'; end if;

 -- 4. Void: version checked, stops counting, frees the date, cannot be voided twice; audit written.
 perform pg_temp.as_user(3);perform pg_temp.refused(format($q$select public.club_dragon_void(%L,%L,1,gen_random_uuid())$q$,pg_temp.c('x'),e),'42501');
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_dragon_void(%L,%L,7,gen_random_uuid())$q$,pg_temp.c('x'),e),'PT409');
 perform public.club_dragon_void(pg_temp.c('x'),e,1,md5('dh-void')::uuid);
 if (public.club_dragon_void(pg_temp.c('x'),e,1,md5('dh-void')::uuid)->>'replayed')<>'true' then raise exception 'Void retry not replayed'; end if;
 perform pg_temp.refused(format($q$select public.club_dragon_void(%L,%L,2,gen_random_uuid())$q$,pg_temp.c('x'),e),'PT409');
 if jsonb_array_length(public.club_player_dragon(pg_temp.c('x'),pg_temp.p('b'))->'absent')<>0 then raise exception 'Voided hunt still counts'; end if;
 perform pg_temp.create('2026-10-03',pg_temp.rows(pg_temp.p('b')),'again');
 if jsonb_array_length(public.club_dragon_list(pg_temp.c('x'),true)->'events')<>1 then raise exception 'Voided list wrong'; end if;
end $$;

-- 5. The table is reachable only through the functions.
do $$ begin perform pg_temp.refused('select * from public.club_dragon_event_players','42501'); end $$;
reset role;
do $$ begin
 if (select count(*) from public.club_audit_events where club_id=md5('dh-club-x')::uuid and action in ('dragon_created','dragon_void'))<>3 then raise exception 'Audit rows wrong'; end if;
end $$;
