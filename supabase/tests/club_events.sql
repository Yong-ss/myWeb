-- Disposable PostgreSQL only. Four-Way League V1 (docs/CLUB_EVENTS_DISCUSSION.md). Everything rolls back after this suite.
-- Why it matters: event results feed every player's attendance, so a write must be all-or-nothing, never duplicate a
-- date or a player, never reach another club, and the three event permissions must follow the agreed layer order
-- (read is required for import/edit; platform admins limited to these three; no self-promotion; raw JSON club-only).
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- 1 owner X; 2 admin X; 3 admin X; 4 platform admin (also admin of Y); 5 alliance leader (alliance with X); 6 owner Y; 7 outsider.
insert into auth.users(id,email,email_confirmed_at) select md5('ev-user-'||n)::uuid,'ev-'||n||'@fixture.invalid',now() from generate_series(1,7)n;
insert into public.club_clubs(id,name) select md5('ev-club-'||c)::uuid,'Event club '||c from unnest(array['x','y'])c;
insert into public.club_memberships(club_id,user_id,role) values
 (md5('ev-club-x')::uuid,md5('ev-user-1')::uuid,'owner'),(md5('ev-club-x')::uuid,md5('ev-user-2')::uuid,'admin'),(md5('ev-club-x')::uuid,md5('ev-user-3')::uuid,'admin'),
 (md5('ev-club-y')::uuid,md5('ev-user-4')::uuid,'admin'),(md5('ev-club-y')::uuid,md5('ev-user-6')::uuid,'owner');
insert into public.platform_role_assignments(user_id,role) values (md5('ev-user-4')::uuid,'platform_admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000ef04',md5('ev-user-4')::uuid,'pa','totp','verified'),('00000000-0000-4000-8000-00000000ef09','d0ddb226-a10a-471c-be4b-d5e5153bd313','sa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000ec04',md5('ev-user-4')::uuid,'aal2','00000000-0000-4000-8000-00000000ef04'),('00000000-0000-4000-8000-00000000ec09','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000ef09');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000ef09');
insert into public.club_alliances(id,name) values (md5('ev-alliance')::uuid,'Event alliance');
insert into public.club_alliance_members(alliance_id,club_id) values (md5('ev-alliance')::uuid,md5('ev-club-x')::uuid);
insert into public.alliance_leaders(alliance_id,user_id) values (md5('ev-alliance')::uuid,md5('ev-user-5')::uuid);
-- Players A..G of X (member history below), and one player of Y.
insert into public.club_players(id,club_id,display_name,match_name) select md5('ev-player-'||p)::uuid,md5('ev-club-x')::uuid,'Player '||p,'Player'||p from unnest(array['a','b','c','d','e','f','g'])p;
insert into public.club_players(id,club_id,display_name,match_name) values (md5('ev-player-y')::uuid,md5('ev-club-y')::uuid,'Player Y','PlayerY');
-- Member history of X: 10-01 A B C E F G; 10-02 complete A B E F G (C left); 10-03 incomplete A E, F marked missed by
-- recognition, G temporary; 10-06 A B D E F G.
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('ev-import-'||d)::uuid,md5('ev-club-x')::uuid,md5('ev-user-1')::uuid,'{}',1,md5('ev-req-'||d)::uuid from unnest(array['01','02','03','06'])d;
insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
 select md5('ev-snap-'||d)::uuid,md5('ev-club-x')::uuid,('2026-10-'||d)::date,1,md5('ev-import-'||d)::uuid,d='02' from unnest(array['01','02','03','06'])d;
insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name)
 select md5('ev-club-x')::uuid,md5('ev-snap-'||d)::uuid,md5('ev-player-'||p)::uuid,'Player '||p from (values
  ('01','a'),('01','b'),('01','c'),('01','e'),('01','f'),('01','g'),('02','a'),('02','b'),('02','e'),('02','f'),('02','g'),
  ('03','a'),('03','e'),('06','a'),('06','b'),('06','d'),('06','e'),('06','f'),('06','g')) v(d,p);
insert into public.club_snapshot_absences(club_id,snapshot_id,player_id,decision,reason) values
 (md5('ev-club-x')::uuid,md5('ev-snap-03')::uuid,md5('ev-player-f')::uuid,'missed',null),(md5('ev-club-x')::uuid,md5('ev-snap-03')::uuid,md5('ev-player-g')::uuid,'temporary','出差');

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('ev-user-'||n)::uuid $$;
create function pg_temp.c(x text) returns uuid language sql as $$ select md5('ev-club-'||x)::uuid $$;
create function pg_temp.p(x text) returns uuid language sql as $$ select md5('ev-player-'||x)::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('ev-user-'||n)::text,true),set_config('request.jwt.claims','{"aal":"aal1"}',true) $$;
create function pg_temp.as_pa() returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('ev-user-4')::text,true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ec04"}',true) $$;
create function pg_temp.as_sa() returns void language sql as $$ select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ec09"}',true) $$;
create function pg_temp.perms(n int,x text) returns text[] language plpgsql as $$ begin perform pg_temp.as_user(n); return array(select k from unnest(public.club_my_permissions(pg_temp.c(x))) k where k like 'events.%'); end $$;
create function pg_temp.refused(sql text,code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then if sqlstate<>code then raise exception '% failed with % (%), expected %',sql,sqlstate,sqlerrm,code; end if; return; end;
 raise exception '% was allowed',sql;
end $$;
-- Table owner readers (event tables are closed to clients).
create function pg_temp.count_of(t text) returns bigint language plpgsql security definer as $$ declare n bigint; begin execute format('select count(*) from public.%I',t) into n; return n; end $$;
-- A participant with all nine metrics.
create function pg_temp.row(player uuid,kills int,name text default null) returns jsonb language sql as $$
 select jsonb_build_object('player_id',player,'name',name,'output_name',coalesce(name,'AI名'),'strategy_name',coalesce(name,'AI名'),'kills',kills,'assists',1,'dispersals',0,'awakens',0,
  'player_damage',501000,'damage_taken',199000,'healing',0,'guardian_damage',4527000,'purification',0) $$;
create function pg_temp.raw() returns text language sql as $$ select '{"schema_version":1,"event_type":"four_way_league","output":[{"player_name":"x"}],"strategy":[{"player_name":"x"}]}' $$;
set local role authenticated;

-- 1. Defaults: owner and admin hold all three; the alliance leader reads only; nobody else; old permissions unchanged.
do $$ begin
 if pg_temp.perms(1,'x')<>array['events.edit','events.import','events.read'] or pg_temp.perms(2,'x')<>array['events.edit','events.import','events.read'] then raise exception 'Default event permissions wrong'; end if;
 if pg_temp.perms(5,'x')<>array['events.read'] or pg_temp.perms(7,'x')<>'{}' or pg_temp.perms(6,'x')<>'{}' then raise exception 'Event read leaks: leader %, outsider %',pg_temp.perms(5,'x'),pg_temp.perms(7,'x'); end if;
 perform pg_temp.as_user(2);
 if array(select k from unnest(public.club_my_permissions(pg_temp.c('x'))) k where k not like 'events.%')<>array['absences.resolve','aliases.manage','audit.read','imports.create','imports.delete','members.read'] then raise exception 'Existing admin permissions changed'; end if;
end $$;

-- 2. Read is required: owner sets the admin read off; import/edit stay set but take no effect (and come back with read).
do $$ begin
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.read',false);
 if pg_temp.perms(2,'x')<>'{}' then raise exception 'Import/edit effective without read: %',pg_temp.perms(2,'x'); end if;
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,'[]','{}',gen_random_uuid())$q$,pg_temp.c('x')),'42501');
 perform pg_temp.refused(format($q$select public.club_events_list(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.refused(format($q$select public.club_event_identities(%L)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.as_user(1);
 if (select x->>'layer' from jsonb_array_elements(public.club_team_permissions(pg_temp.c('x'))->'admins') a, jsonb_array_elements(a->'explain'->'permissions') x where (a->>'user_id')::uuid=pg_temp.u(2) and x->>'key'='events.import')<>'needs_read' then raise exception 'Explanation does not say read is missing'; end if;
 perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.read',null);
 -- Read yes, import no, edit no: read only.
 perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.import',false);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',false);
 if pg_temp.perms(2,'x')<>array['events.read'] then raise exception 'Read-only admin wrong: %',pg_temp.perms(2,'x'); end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.import',null);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',null);
end $$;

-- 3. Platform admin layer: club role level, a personal exception over it, Super Admin and caps above, no self-promotion.
do $$ begin
 perform pg_temp.as_user(4);perform pg_temp.refused(format($q$select public.platform_event_permissions(%L)$q$,pg_temp.c('x')),'42501'); -- no MFA
 perform pg_temp.as_user(7);perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,'admin',null,'events.edit',false)$q$,pg_temp.c('x')),'42501');
 perform pg_temp.as_pa();
 perform pg_temp.refused(format($q$select public.platform_set_personal_permission(%L,%L,'events.edit',false)$q$,pg_temp.c('x'),pg_temp.u(2)),'42501'); -- not platform.permissions.manage
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,'admin',null,'members.read',false)$q$,pg_temp.c('x')),'22023');
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,'admin',%L,'events.edit',false)$q$,pg_temp.c('x'),pg_temp.u(2)),'22023'); -- both levels
 -- Role level: admins of X lose edit; X's owner and Y's admins are untouched.
 perform public.platform_set_event_permission(pg_temp.c('x'),'admin',null,'events.edit',false);
 if pg_temp.perms(2,'x')<>array['events.import','events.read'] or pg_temp.perms(1,'x')<>array['events.edit','events.import','events.read'] then raise exception 'Platform role deny wrong'; end if;
 -- Personal allow for admin 3 wins over the platform role deny (same layer, personal first).
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('x'),null,pg_temp.u(3),'events.edit',true);
 if pg_temp.perms(3,'x')<>array['events.edit','events.import','events.read'] or pg_temp.perms(2,'x')<>array['events.import','events.read'] then raise exception 'Personal exception wrong'; end if;
 -- The owner cannot lift a platform deny for admin 2 (owner layer is lower).
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',true);
 if pg_temp.perms(2,'x')<>array['events.import','events.read'] then raise exception 'Owner bypassed the platform deny'; end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(pg_temp.c('x'),pg_temp.u(2),'events.edit',null);
 -- Super Admin forced deny beats the platform personal allow; the Super Admin cap beats everything.
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(pg_temp.c('x'),pg_temp.u(3),'events.edit',false);
 if 'events.edit'=any(pg_temp.perms(3,'x')) then raise exception 'Platform allow beat the Super Admin deny'; end if;
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(pg_temp.c('x'),pg_temp.u(3),'events.edit',null);
 perform public.platform_set_role_permission('cap','admin','events.edit',false);
 if 'events.edit'=any(pg_temp.perms(3,'x')) then raise exception 'Platform allow beat the cap'; end if;
 perform pg_temp.as_sa();perform public.platform_set_role_permission('cap','admin','events.edit',true);
 -- Revoking the personal exception falls back to the role deny; revoking that restores the default.
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('x'),null,pg_temp.u(3),'events.edit',null);
 if 'events.edit'=any(pg_temp.perms(3,'x')) then raise exception 'Revoked exception still applies'; end if;
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('x'),'admin',null,'events.edit',null);
 if pg_temp.perms(3,'x')<>array['events.edit','events.import','events.read'] then raise exception 'Default not restored'; end if;
 -- No self-promotion: own account, or the role the platform admin holds in Y.
 perform pg_temp.as_pa();
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,null,%L,'events.edit',true)$q$,pg_temp.c('y'),pg_temp.u(4)),'42501');
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,'admin',null,'events.edit',true)$q$,pg_temp.c('y')),'42501');
 perform public.platform_set_event_permission(pg_temp.c('y'),'owner',null,'events.read',false);
 if pg_temp.perms(6,'y')<>'{}' then raise exception 'Owner role deny in Y not applied'; end if;
 perform pg_temp.as_pa();perform public.platform_set_event_permission(pg_temp.c('y'),'owner',null,'events.read',null);
 -- A personal setting needs an owner/admin role there; the database refuses platform rows for other permissions.
 perform pg_temp.refused(format($q$select public.platform_set_event_permission(%L,null,%L,'events.read',false)$q$,pg_temp.c('x'),pg_temp.u(7)),'PT409');
 if jsonb_array_length(public.platform_event_permissions(pg_temp.c('x'))->'members')<>3 then raise exception 'Platform reader lists wrong members'; end if;
end $$;
reset role;
-- A platform personal row applies only while the account holds an owner/admin role there (rows outlive role changes):
-- under any other club role it gives nothing.
do $$ begin
 insert into public.club_permission_overrides(club_id,user_id,permission_key,set_by,allowed) values (md5('ev-club-x')::uuid,md5('ev-user-3')::uuid,'events.edit','platform',true);
 if club_private.permission_layer(md5('ev-club-x')::uuid,md5('ev-user-3')::uuid,'x_custom','events.edit')<>'default_deny' then raise exception 'Platform personal row reached a non-owner/admin role'; end if;
 if club_private.permission_layer(md5('ev-club-x')::uuid,md5('ev-user-3')::uuid,'admin','events.edit')<>'platform_allow' then raise exception 'Platform personal row lost for admin'; end if;
 delete from public.club_permission_overrides where user_id=md5('ev-user-3')::uuid and set_by='platform';
end $$;
do $$ begin
 begin insert into public.club_permission_overrides(club_id,user_id,permission_key,set_by,allowed) values (md5('ev-club-x')::uuid,md5('ev-user-2')::uuid,'members.read','platform',true);
  raise exception 'Platform row for a non-event permission accepted'; exception when check_violation then null; end;
end $$;
set local role authenticated;

-- 4. Create: validation, one valid event per date, idempotent retries, all-or-nothing new players and aliases.
do $$ declare x uuid:=pg_temp.c('x'); r uuid:=gen_random_uuid(); first jsonb; players int; begin
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_event_create(%L,%L,100,%L,%L,gen_random_uuid())$q$,x,current_date+2,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3)),pg_temp.raw()),'22023'); -- future
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3)-'healing'),pg_temp.raw()),'22023'); -- half a row
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3)||'{"kills":null}'),pg_temp.raw()),'22023'); -- null is not 0
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3),pg_temp.row(pg_temp.p('e'),4)),pg_temp.raw()),'PT409'); -- same player twice
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('y'),3)),pg_temp.raw()),'42501'); -- other club's player
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,'{"schema_version":1}',gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3))),'22023');
 -- A new player with an existing exact name is refused, and nothing (event or player) is left behind.
 players:=pg_temp.count_of('club_players');
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),3),pg_temp.row(null,1,'新人'),pg_temp.row(null,1,'Player a')),pg_temp.raw()),'PT409');
 -- Remembering an AI alias needs aliases.manage: admin 2 loses it, the whole create rolls back.
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(x,pg_temp.u(2),'aliases.manage',false);perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',100,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(null,1,'新人'),pg_temp.row(pg_temp.p('e'),3)||'{"output_name":"Player e丶","remember_alias":true}'),pg_temp.raw()),'42501');
 if pg_temp.count_of('club_players')<>players or pg_temp.count_of('club_events')<>0 then raise exception 'Failed create left rows behind'; end if;
 perform pg_temp.as_user(1);perform public.club_set_admin_permission(x,pg_temp.u(2),'aliases.manage',null);perform pg_temp.as_user(2);
 -- Success: E and a new player; retry returns the same event; the same id with other content is refused.
 first:=public.club_event_create(x,'2026-10-04',3000,jsonb_build_array(pg_temp.row(pg_temp.p('e'),9),pg_temp.row(null,0,'新人')||'{"output_name":"新人丶","remember_alias":true}'),pg_temp.raw(),r);
 if (public.club_event_create(x,'2026-10-04',3000,jsonb_build_array(pg_temp.row(pg_temp.p('e'),9),pg_temp.row(null,0,'新人')||'{"output_name":"新人丶","remember_alias":true}'),pg_temp.raw(),r)->>'event_id')<>first->>'event_id' then raise exception 'Retry created another event'; end if;
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',1,%L,%L,%L)$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('e'),9)),pg_temp.raw(),r),'22023');
 perform pg_temp.refused(format($q$select public.club_event_create(%L,'2026-10-04',1,%L,%L,gen_random_uuid())$q$,x,jsonb_build_array(pg_temp.row(pg_temp.p('a'),9)),pg_temp.raw()),'PT409'); -- same date
 if pg_temp.count_of('club_events')<>1 or pg_temp.count_of('club_players')<>players+1 or pg_temp.count_of('club_player_aliases')<>1 then raise exception 'Create stored wrong rows'; end if;
 if (public.club_event_detail(x,(first->>'event_id')::uuid)->'event'->>'total_kills')::int<>9 then raise exception 'Total kills is not the sum of kills'; end if;
 -- Y's owner, the outsider and the alliance leader cannot write; the leader reads but never sees the raw JSON.
 perform pg_temp.as_user(6);perform pg_temp.refused(format($q$select public.club_event_detail(%L,%L)$q$,x,first->>'event_id'),'42501');
 perform pg_temp.as_user(5);
 if public.club_event_detail(x,(first->>'event_id')::uuid)->'raw_text'<>'null'::jsonb then raise exception 'Raw JSON reached the alliance leader'; end if;
 if jsonb_array_length(public.club_events_list(x)->'events')<>1 then raise exception 'Leader cannot read the list'; end if;
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,1,'void','{}',gen_random_uuid())$q$,x,first->>'event_id'),'42501');
 perform pg_temp.refused(format($q$select public.club_event_identities(%L)$q$,x),'42501');
 perform pg_temp.as_user(1);
 if public.club_event_detail(x,(first->>'event_id')::uuid)->>'raw_text'<>pg_temp.raw() then raise exception 'Raw JSON not kept verbatim for the club'; end if;
end $$;

-- 5. Corrections: versions, conflicts, rebind/remove/add, date change, void frees the date, restore checks it.
do $$ declare x uuid:=pg_temp.c('x'); e uuid; newbie uuid; d jsonb; second uuid; begin
 perform pg_temp.as_user(2);
 e:=(public.club_events_list(x)->'events'->0->>'id')::uuid;
 newbie:=(select (p->>'player_id')::uuid from jsonb_array_elements(public.club_event_detail(x,e)->'players') p where p->>'display_name'='新人');
 perform public.club_event_update(x,e,1,'score','{"total_score":3100}',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,1,'score','{"total_score":3200}',gen_random_uuid())$q$,x,e),'PT409'); -- stale version
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,2,'score','{"total_score":-1}',gen_random_uuid())$q$,x,e),'22023');
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,2,'score','{"total_score":1,"x":1}',gen_random_uuid())$q$,x,e),'22023');
 -- Rebind E -> A works; A -> new player while new player is in the event is refused.
 perform public.club_event_update(x,e,2,'rebind',jsonb_build_object('from_player',pg_temp.p('e'),'to_player',pg_temp.p('a'),'name',null),gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,3,'rebind',%L,gen_random_uuid())$q$,x,e,jsonb_build_object('from_player',pg_temp.p('a'),'to_player',newbie,'name',null)),'PT409');
 -- Rebind back A -> E, edit E's metrics, add B manually (both tables), remove the newcomer.
 perform public.club_event_update(x,e,3,'rebind',jsonb_build_object('from_player',pg_temp.p('a'),'to_player',pg_temp.p('e'),'name',null),gen_random_uuid());
 perform public.club_event_update(x,e,4,'metrics',(pg_temp.row(pg_temp.p('e'),12)-'name'-'output_name'-'strategy_name'),gen_random_uuid());
 -- Saving the same values again is refused (no empty version that would conflict with other editors).
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,5,'metrics',%L,gen_random_uuid())$q$,x,e,pg_temp.row(pg_temp.p('e'),12)-'name'-'output_name'-'strategy_name'),'22023');
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,5,'add',%L,gen_random_uuid())$q$,x,e,pg_temp.row(pg_temp.p('e'),1)),'PT409');
 perform public.club_event_update(x,e,5,'add',pg_temp.row(pg_temp.p('b'),2),gen_random_uuid());
 perform public.club_event_update(x,e,6,'remove',jsonb_build_object('player_id',newbie),gen_random_uuid());
 d:=public.club_event_detail(x,e);
 if (d->'event'->>'total_kills')::int<>14 or jsonb_array_length(d->'players')<>2 or (d->'event'->>'version')::int<>7 or jsonb_array_length(d->'versions')<>7 then raise exception 'Corrections stored wrong: %',d->'event'; end if;
 if (select p->>'origin' from jsonb_array_elements(d->'players') p where (p->>'player_id')::uuid=pg_temp.p('b'))<>'manual' then raise exception 'Manual add not marked'; end if;
 if not exists(select 1 from public.club_players where id=newbie) then raise exception 'Removing a result deleted the player'; end if;
 if (public.club_event_version(x,e,1)->'state'->'players')::text not like '%新人%' then raise exception 'Old version lost'; end if;
 -- Last participant cannot be removed.
 perform public.club_event_update(x,e,7,'remove',jsonb_build_object('player_id',pg_temp.p('b')),gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,8,'remove',%L,gen_random_uuid())$q$,x,e,jsonb_build_object('player_id',pg_temp.p('e'))),'PT409');
 -- A second event on 10-08; moving it onto 10-04 is refused; voiding 10-04 frees the date; restoring it is then refused.
 second:=(public.club_event_create(x,'2026-10-08',10,jsonb_build_array(pg_temp.row(pg_temp.p('e'),1)),pg_temp.raw(),gen_random_uuid())->>'event_id')::uuid;
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,1,'date','{"event_date":"2026-10-04"}',gen_random_uuid())$q$,x,second),'PT409');
 perform public.club_event_update(x,e,8,'void','{}',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,9,'score','{"total_score":1}',gen_random_uuid())$q$,x,e),'PT409');
 perform public.club_event_update(x,second,1,'date','{"event_date":"2026-10-04"}',gen_random_uuid());
 perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,9,'restore','{}',gen_random_uuid())$q$,x,e),'PT409');
 perform public.club_event_update(x,second,2,'date','{"event_date":"2026-10-08"}',gen_random_uuid());
 perform public.club_event_update(x,e,9,'restore','{}',gen_random_uuid());
 if jsonb_array_length(public.club_events_list(x)->'events')<>2 or jsonb_array_length(public.club_events_list(x,true)->'events')<>0 then raise exception 'Void/restore list wrong'; end if;
 -- Keyset paging: the cursor (date, id) continues after the last event shown, never skipping same-date voided events.
 if jsonb_array_length(public.club_events_list(x,false,'2026-10-08',second)->'events')<>1 or public.club_events_list(x,false,'2026-10-08',second)->'events'->0->>'event_date'<>'2026-10-04' then raise exception 'Keyset cursor wrong'; end if;
 -- The same event id never answers for another club.
 perform pg_temp.as_user(6);perform pg_temp.refused(format($q$select public.club_event_update(%L,%L,10,'void','{}',gen_random_uuid())$q$,pg_temp.c('y'),e),'22023');
end $$;

-- 6. Attendance (events 10-04 with E, 10-08 with E). A: present before/after with nothing in between -> absent on 10-04.
-- B: an incomplete roster without them and no decision -> not counted (uncertain). C: left in a complete roster -> not
-- counted. D: first seen later -> not counted. F: marked missed by recognition -> absent. G: temporary -> not counted.
-- 10-08 is after the last roster -> nobody is absent there yet.
do $$ declare x uuid:=pg_temp.c('x'); r jsonb; begin
 perform pg_temp.as_user(5); -- alliance leaders read attendance too
 r:=public.club_player_events(x,pg_temp.p('e'));
 if jsonb_array_length(r->'attended')<>2 or jsonb_array_length(r->'absent')<>0 or (r->'attended'->0->>'kills')::int<>1 then raise exception 'E attendance wrong: %',r; end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('a'))->'absent')<>1 or public.club_player_events(x,pg_temp.p('a'))->'absent'->0->>'event_date'<>'2026-10-04' then raise exception 'A absence wrong: %',public.club_player_events(x,pg_temp.p('a')); end if;
 if (public.club_player_events(x,pg_temp.p('a'))->>'uncertain')::int<>1 then raise exception 'A after-last-roster event not uncertain'; end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('b'))->'absent')<>0 or (public.club_player_events(x,pg_temp.p('b'))->>'uncertain')::int<>2 then raise exception 'B wrong: %',public.club_player_events(x,pg_temp.p('b')); end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('c'))->'absent')<>0 or (public.club_player_events(x,pg_temp.p('c'))->>'uncertain')::int<>0 then raise exception 'C wrong: %',public.club_player_events(x,pg_temp.p('c')); end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('d'))->'absent')<>0 then raise exception 'D counted before joining'; end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('f'))->'absent')<>1 then raise exception 'F (missed by recognition) not absent'; end if;
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('g'))->'absent')<>0 then raise exception 'G temporary leave counted as absent'; end if;
 if public.club_player_events(x,pg_temp.p('y')) is not null then raise exception 'Another club''s player answered'; end if;
 -- Voiding removes the event from attendance; the same player attended -> after rebind they are absent.
 perform pg_temp.as_user(1);
 perform public.club_event_update(x,(select (e->>'id')::uuid from jsonb_array_elements(public.club_events_list(x)->'events') e where e->>'event_date'='2026-10-04'),10,'void','{}',gen_random_uuid());
 if jsonb_array_length(public.club_player_events(x,pg_temp.p('a'))->'absent')<>0 or jsonb_array_length(public.club_player_events(x,pg_temp.p('e'))->'attended')<>1 then raise exception 'Voided event still counted'; end if;
end $$;

-- 7. Clients never touch the event tables directly; history is append-only.
do $$ begin
 perform pg_temp.refused('select * from public.club_events','42501');
 perform pg_temp.refused('select * from public.club_event_imports','42501');
 perform pg_temp.refused('select * from public.club_event_players','42501');
end $$;
reset role;
do $$ begin
 begin update public.club_event_versions set action='void'; raise exception 'Version history editable'; exception when insufficient_privilege then null; end;
 begin delete from public.club_event_imports; raise exception 'Raw import deletable'; exception when insufficient_privilege then null; end;
end $$;
