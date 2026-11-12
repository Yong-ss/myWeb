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


do $$ declare e uuid; r jsonb; req uuid=md5('edit-add')::uuid; begin
 perform pg_temp.as_user(1);
 e:=(pg_temp.create('2026-10-01',pg_temp.rows(pg_temp.p('a')),'edit-create')->>'event_id')::uuid;
 r:=public.club_dragon_attendance_edit(pg_temp.c('x'),e,1,req,'add',pg_temp.p('b'));
 if (r->>'version')::int<>2 then raise exception 'Version not incremented'; end if;
 r:=public.club_dragon_attendance_edit(pg_temp.c('x'),e,1,req,'add',pg_temp.p('b'));
 if not (r->>'replayed')::boolean then raise exception 'Retry not idempotent'; end if;
 perform pg_temp.refused(format('select public.club_dragon_attendance_edit(%L,%L,1,%L,''remove'',%L)',pg_temp.c('x'),e,md5('stale')::uuid,pg_temp.p('a')),'PT409');
 perform pg_temp.refused(format('select public.club_dragon_attendance_edit(%L,%L,2,%L,''add'',%L)',pg_temp.c('x'),e,md5('foreign')::uuid,pg_temp.p('y')),'22023');
 perform pg_temp.as_user(3);
 perform pg_temp.refused(format('select public.club_dragon_attendance_edit(%L,%L,2,%L,''remove'',%L)',pg_temp.c('x'),e,md5('leader')::uuid,pg_temp.p('a')),'42501');
 perform pg_temp.as_user(1);
 perform public.club_dragon_attendance_edit(pg_temp.c('x'),e,2,md5('remove')::uuid,'remove',pg_temp.p('a'));
 r:=public.club_dragon_detail(pg_temp.c('x'),e);
 if jsonb_array_length(r->'players')<>1 or r#>>'{players,0,player_id}'<>pg_temp.p('b')::text or not (r->>'can_edit_attendance')::boolean then raise exception 'Wrong current attendance'; end if;
 if not exists(select 1 from jsonb_array_elements(r->'absent') p where p->>'player_id'=pg_temp.p('a')::text) then raise exception 'Removed member must return to exact-day absence'; end if;
 perform public.club_dragon_void(pg_temp.c('x'),e,3,md5('void-edit')::uuid);
 perform pg_temp.refused(format('select public.club_dragon_attendance_edit(%L,%L,4,%L,''add'',%L)',pg_temp.c('x'),e,md5('voided-add')::uuid,pg_temp.p('a')),'PT409');
end $$;
reset role;
do $$ begin
 if (select count(*) from public.club_audit_events where action in ('dragon_attendance_add','dragon_attendance_remove'))<>2 then raise exception 'Missing audit or duplicate replay'; end if;
 if (select count(*) from public.club_event_versions where action in ('add','remove'))<>2 then raise exception 'Version history missing'; end if;
end $$;
