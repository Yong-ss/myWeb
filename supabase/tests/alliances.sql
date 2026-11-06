-- Disposable PostgreSQL only. Stage F: alliances and alliance leaders. Everything rolls back after this suite.
-- Why it matters: a leader sees several clubs' data, so reading must stop exactly at their own alliance's clubs, never
-- include raw imports, never become a write, and end the moment the leader or the club's membership changes.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.users(id,email,email_confirmed_at) select md5('al-user-'||n)::uuid,'al-'||n||'@fixture.invalid',now() from generate_series(1,9)n;
-- 1 leader of A1 (no club role); 2 leader of A2 and owner of Y (in A1); 3 owner of X; 4 owner of W (no alliance);
-- 5 admin of W; 6 platform admin (own verified factor); 7 ordinary account; 8 owner of Z; 9 spare.
insert into public.club_clubs(id,name) select md5('al-club-'||c)::uuid,'Alliance club '||c from unnest(array['x','y','z','w'])c;
insert into public.club_memberships(club_id,user_id,role) values
 (md5('al-club-y')::uuid,md5('al-user-2')::uuid,'owner'),(md5('al-club-x')::uuid,md5('al-user-3')::uuid,'owner'),
 (md5('al-club-w')::uuid,md5('al-user-4')::uuid,'owner'),(md5('al-club-w')::uuid,md5('al-user-5')::uuid,'admin'),
 (md5('al-club-z')::uuid,md5('al-user-8')::uuid,'owner');
insert into public.club_players(id,club_id,display_name,match_name) select md5('al-player-'||c)::uuid,md5('al-club-'||c)::uuid,'P '||c,'P '||c from unnest(array['x','y','z','w'])c;
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values (md5('al-import-x')::uuid,md5('al-club-x')::uuid,md5('al-user-3')::uuid,'{"secret":"raw json"}',1,gen_random_uuid());
insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id) values (md5('al-snap-x')::uuid,md5('al-club-x')::uuid,'2026-10-01',1,md5('al-import-x')::uuid);
insert into public.club_audit_events(club_id,actor_id,action) values (md5('al-club-x')::uuid,md5('al-user-3')::uuid,'alliance_fixture');
insert into public.platform_role_assignments(user_id,role) values (md5('al-user-6')::uuid,'platform_admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000af06',md5('al-user-6')::uuid,'pa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000ac06',md5('al-user-6')::uuid,'aal2','00000000-0000-4000-8000-00000000af06');

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('al-user-'||n)::uuid $$;
create function pg_temp.c(x text) returns uuid language sql as $$ select md5('al-club-'||x)::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('al-user-'||n)::text,true),set_config('request.jwt.claims','{"aal":"aal1"}',true) $$;
create function pg_temp.as_pa() returns void language sql as $$ select set_config('request.jwt.claim.sub',md5('al-user-6')::text,true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ac06"}',true) $$;
create function pg_temp.perms(n int,x text) returns text[] language plpgsql as $$ begin perform pg_temp.as_user(n); return public.club_my_permissions(pg_temp.c(x)); end $$;
-- Fixture reader as the table owner (alliance tables are closed to clients).
create function pg_temp.alliance_of(x text) returns uuid language sql security definer as $$ select alliance_id from public.club_alliance_members where club_id=md5('al-club-'||x)::uuid and status='active' $$;
create function pg_temp.request_of(x text) returns uuid language sql security definer as $$ select id from public.club_alliance_requests where club_id=md5('al-club-'||x)::uuid and status='pending' $$;
create function pg_temp.all_events() returns setof jsonb language plpgsql as $$
declare page jsonb; cur jsonb := null;
begin
 loop
  page:=public.platform_activity((cur->>'before')::timestamptz,(cur->>'id')::uuid);
  return query select value from jsonb_array_elements(page->'events');
  cur:=page->'next'; exit when cur is null or cur='null'::jsonb;
 end loop;
end $$;
create function pg_temp.refused(sql text,code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then if sqlstate<>code then raise exception '% failed with % (%), expected %',sql,sqlstate,sqlerrm,code; end if; return; end;
 raise exception '% was allowed',sql;
end $$;

-- 1. Registry: alliance permissions are read-only for club data; the leader role holds only reads and join decisions.
do $$ begin
 if (select array_agg(permission_key order by permission_key) from public.auth_role_permissions where role_key='alliance_leader')<>array['alliance.joins.decide','audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Leader permissions wrong'; end if;
 perform pg_temp.refused($q$insert into public.auth_permissions(key,kind,allowed_scopes,read_only,description) values('imports.alliance','action','{club,alliance}',false,'x')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_permissions(key,kind,allowed_scopes,read_only,description) values('alliance.write_clubs','action','{club,alliance}',false,'x')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('alliance_leader','imports.create')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('alliance_leader','club.rename')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('admin','club.alliance.request')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('alliance_leader','platform.read')$q$,'23514');
end $$;

set local role authenticated;
-- 2. Platform: only an active platform role creates alliances, places clubs and appoints leaders.
do $$ declare a1 uuid; a2 uuid; begin
 foreach a1 in array array[pg_temp.u(7),pg_temp.u(3)] loop
  perform set_config('request.jwt.claim.sub',a1::text,true);perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform pg_temp.refused($q$select public.platform_save_alliance(null,'Forged','active')$q$,'42501');
  perform pg_temp.refused('select public.platform_alliances()','42501');
 end loop;
 perform pg_temp.as_user(6); -- platform admin without TOTP
 perform pg_temp.refused($q$select public.platform_save_alliance(null,'No MFA','active')$q$,'42501');
 perform pg_temp.as_pa();
 a1:=(public.platform_save_alliance(null,'Alliance One','active')->>'id')::uuid;
 a2:=(public.platform_save_alliance(null,'Alliance Two','active')->>'id')::uuid;
 perform pg_temp.refused($q$select public.platform_save_alliance(null,' alliance one ','active')$q$,'PT409');
 perform pg_temp.refused($q$select public.platform_save_alliance(null,'','active')$q$,'22023');
 perform public.platform_set_club_alliance(pg_temp.c('x'),a1);perform public.platform_set_club_alliance(pg_temp.c('y'),a1);perform public.platform_set_club_alliance(pg_temp.c('z'),a2);
 perform public.platform_set_alliance_leader(a1,'AL-1@fixture.invalid','grant');
 perform public.platform_set_alliance_leader(a2,'al-2@fixture.invalid','grant');
 -- One leader per alliance, one alliance per person, unknown accounts like any other refusal, never themselves.
 perform pg_temp.refused(format($q$select public.platform_set_alliance_leader(%L,'al-9@fixture.invalid','grant')$q$,a1),'PT409');
 perform pg_temp.refused(format($q$select public.platform_set_alliance_leader(%L,'al-1@fixture.invalid','grant')$q$,(public.platform_save_alliance(null,'Alliance Three','active')->>'id')::uuid),'PT409');
 perform pg_temp.refused(format($q$select public.platform_set_alliance_leader(%L,'nobody@fixture.invalid','grant')$q$,a1),'22023');
 perform pg_temp.refused(format($q$select public.platform_set_alliance_leader((select id from jsonb_to_recordset(public.platform_alliances()->'alliances') x(id uuid,name text) where name='Alliance Three'),'al-6@fixture.invalid','grant')$q$),'42501');
 -- The leader role's permission rules have no writer, even for the stage B layer writers.
 perform pg_temp.refused($q$select public.platform_set_role_permission('platform_default','alliance_leader','members.read',false)$q$,'42501');
 if jsonb_array_length(public.platform_alliances()->'alliances')<>3 then raise exception 'Platform list wrong'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.platform_audit_events where actor_id=md5('al-user-6')::uuid and action in ('club_alliances.insert','club_alliance_members.insert','alliance_leaders.insert'))<>8
  then raise exception 'Alliance changes not audited with the platform admin'; end if;
end $$;

set local role authenticated;
do $$ declare t text; begin
 foreach t in array array['club_alliances','club_alliance_members','alliance_leaders','club_alliance_requests'] loop
  perform pg_temp.refused(format('select * from public.%I',t),'42501');perform pg_temp.refused(format('delete from public.%I',t),'42501');
 end loop;
end $$;
-- 3. Reading: exactly the leader's alliance's clubs, read-only permissions only, no raw imports, no actor emails.
do $$ declare ev jsonb; begin
 if pg_temp.perms(1,'x')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] or pg_temp.perms(1,'y')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Leader cannot read own alliance'; end if;
 if pg_temp.perms(1,'z')<>'{}' or pg_temp.perms(1,'w')<>'{}' then raise exception 'Leader reads another alliance or a club outside alliances'; end if;
 perform pg_temp.as_user(1);
 if (select count(*) from public.club_players where club_id in (pg_temp.c('x'),pg_temp.c('y')))<>2 or exists(select 1 from public.club_players where club_id in (pg_temp.c('z'),pg_temp.c('w'))) then raise exception 'RLS does not follow the alliance'; end if;
 if exists(select 1 from public.club_imports) then raise exception 'Raw import JSON visible to a leader'; end if;
 ev:=public.club_activity(pg_temp.c('x'));
 if jsonb_array_length(ev->'events')<1 or ev::text like '%al-3@fixture.invalid%' then raise exception 'Club log wrong for a leader: %',ev; end if;
 if jsonb_array_length(public.club_activity(pg_temp.c('z'))->'events')<>0 then raise exception 'Other alliance log visible'; end if;
 if (public.club_my_alliance()->'alliance'->>'name')<>'Alliance One' or jsonb_array_length(public.club_my_alliance()->'clubs')<>2 then raise exception 'Workspace reader wrong'; end if;
 if not (public.club_my_access(pg_temp.c('w'))->>'alliance_leader')::boolean then raise exception 'Leader flag missing (needed to sign in without a club role)'; end if;
 -- The club's own owner still reads raw imports.
 perform pg_temp.as_user(3);
 if not exists(select 1 from public.club_imports where club_id=pg_temp.c('x')) then raise exception 'Owner lost raw imports'; end if;
 perform pg_temp.as_user(7);
 if public.club_my_alliance()->'alliance'<>'null'::jsonb then raise exception 'Non-leader has an alliance'; end if;
end $$;

-- 4. Never a write: business, roles, permissions, alliance requests, platform tools.
do $$ declare x uuid:=pg_temp.c('x'); begin
 perform pg_temp.as_user(1);
 perform pg_temp.refused(format($q$select public.club_rename(%L,'Taken over','Alliance club x')$q$,x),'42501');
 perform pg_temp.refused(format($q$select public.club_change_admin(%L,%L,'grant',0,gen_random_uuid())$q$,x,pg_temp.u(9)),'42501');
 perform pg_temp.refused(format($q$select public.club_set_admin_default(%L,'imports.delete',false)$q$,x),'42501');
 perform pg_temp.refused(format($q$select public.club_request_alliance(%L,%L)$q$,x,pg_temp.alliance_of('z')),'42501');
 perform pg_temp.refused(format($q$select public.club_delete_import_date(%L,'2026-10-01',null)$q$,x),'42501');
 perform pg_temp.refused(format($q$select public.club_team_admins(%L)$q$,x),'42501');
 perform pg_temp.refused($q$select public.platform_save_alliance(null,'Mine','active')$q$,'42501');
 perform pg_temp.refused(format($q$select public.platform_set_club_alliance(%L,null)$q$,x),'42501');
 perform pg_temp.refused(format($q$insert into public.club_players(club_id,display_name,match_name) values(%L,'n','n')$q$,x),'42501');
end $$;

-- 5. Leader and owner at once: full owner powers in their own club (Y), read-only elsewhere (Z is another alliance's).
do $$ begin
 if not ('club.rename'=any(pg_temp.perms(2,'y'))) then raise exception 'Owner powers lost by also leading an alliance'; end if;
 perform pg_temp.as_user(2);perform public.club_rename(pg_temp.c('y'),'Renamed by owner','Alliance club y');
 if pg_temp.perms(2,'z')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Leader read wrong for own alliance club'; end if;
 perform pg_temp.refused(format($q$select public.club_rename(%L,'x','Alliance club z')$q$,pg_temp.c('z')),'42501');
 if pg_temp.perms(2,'x')<>'{}' then raise exception 'Leader of A2 reads A1'; end if;
end $$;

-- 6. Join requests: the owner asks, only this alliance's leader decides, one pending at a time.
do $$ declare a1 uuid:=pg_temp.alliance_of('x'); w uuid:=pg_temp.c('w'); begin
 perform pg_temp.as_user(5); -- admin of W
 perform pg_temp.refused(format('select public.club_request_alliance(%L,%L)',w,a1),'42501');
 perform pg_temp.refused(format('select public.club_alliance_status(%L)',w),'42501');
 perform pg_temp.as_user(4);
 if jsonb_array_length(public.club_alliance_status(w)->'alliances')<3 then raise exception 'Owner cannot see alliances'; end if;
 perform pg_temp.refused(format('select public.club_request_alliance(%L,%L)',w,gen_random_uuid()),'22023');
 perform public.club_request_alliance(w,a1);
 perform pg_temp.refused(format('select public.club_request_alliance(%L,%L)',w,a1),'PT409');
 perform pg_temp.as_user(3); -- owner of X, already in an alliance
 perform pg_temp.refused(format('select public.club_request_alliance(%L,%L)',pg_temp.c('x'),pg_temp.alliance_of('z')),'PT409');
 perform pg_temp.as_user(2); -- the other alliance's leader
 if jsonb_array_length(public.club_my_alliance()->'requests')<>0 then raise exception 'Another alliance sees the request'; end if;
 perform pg_temp.refused(format('select public.alliance_decide_request(%L,%L)',pg_temp.request_of('w'),'approve'),'42501');
 perform pg_temp.refused(format('select public.alliance_decide_request(%L,%L)',gen_random_uuid(),'approve'),'42501');
 perform pg_temp.as_user(1);
 if jsonb_array_length(public.club_my_alliance()->'requests')<>1 then raise exception 'Leader does not see the request'; end if;
 if pg_temp.perms(1,'w')<>'{}' then raise exception 'Read before approval'; end if;
 perform public.alliance_decide_request(pg_temp.request_of('w'),'approve');
 if pg_temp.perms(1,'w')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Approval did not apply at once'; end if;
 perform pg_temp.refused('select public.alliance_decide_request(null,''approve'')','22023');
 -- Withdraw and reject.
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(w,null);
 perform pg_temp.as_user(4);perform public.club_request_alliance(w,a1);
 if not (public.club_withdraw_alliance_request(w)->>'changed')::boolean then raise exception 'Withdraw failed'; end if;
 perform public.club_request_alliance(w,a1);
 perform pg_temp.as_user(1);perform public.alliance_decide_request(pg_temp.request_of('w'),'reject');
 if pg_temp.perms(1,'w')<>'{}' then raise exception 'Rejected club readable'; end if;
end $$;
reset role;
do $$ begin
 if (select array_agg(status order by created_at) from public.club_alliance_requests where club_id=md5('al-club-w')::uuid)<>array['approved','withdrawn','rejected'] then raise exception 'Request history wrong'; end if;
 if (select count(*) from public.club_audit_events where club_id=md5('al-club-w')::uuid and action in ('alliance_requested','alliance_request_withdrawn'))<>4 then raise exception 'Owner actions missing from the club log'; end if;
 if not exists(select 1 from public.platform_audit_events where actor_id=md5('al-user-1')::uuid and action='club_alliance_requests.update') then raise exception 'Leader decision not audited'; end if;
end $$;

set local role authenticated;
-- 7. Changes apply to the next statement: moving a club, a pending request closed by the move, revoking, disabling.
do $$ declare a1 uuid:=pg_temp.alliance_of('x'); a2 uuid:=pg_temp.alliance_of('z'); begin
 perform pg_temp.as_user(4);perform public.club_request_alliance(pg_temp.c('w'),a2);
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(pg_temp.c('w'),a1);
 if pg_temp.request_of('w') is not null then raise exception 'Pending request survived a direct placement'; end if;
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(pg_temp.c('y'),a2);
 if pg_temp.perms(1,'y')<>'{}' or pg_temp.perms(2,'y') @> array['club.rename']=false then raise exception 'Move not applied at once'; end if;
 perform pg_temp.as_pa();perform public.platform_set_alliance_leader(a1,null,'revoke');
 if pg_temp.perms(1,'x')<>'{}' then raise exception 'Revoked leader kept access'; end if;
 perform pg_temp.as_user(1);
 if public.club_my_alliance()->'alliance'<>'null'::jsonb or (public.club_my_access(pg_temp.c('x'))->>'alliance_leader')::boolean then raise exception 'Revoked leader still listed'; end if;
 perform pg_temp.as_pa();perform public.platform_save_alliance(a2,'Alliance Two','disabled');
 if pg_temp.perms(2,'z')<>'{}' then raise exception 'Disabled alliance still readable'; end if;
 perform pg_temp.as_pa();perform public.platform_save_alliance(a2,'Alliance Two','active');
 if pg_temp.perms(2,'z')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Re-enabled alliance not readable'; end if;
 perform pg_temp.as_user(2);perform public.club_rename(pg_temp.c('y'),'Still owner','Renamed by owner'); -- owner power unchanged by all of this
end $$;
reset role;
-- 7b. The Super Admin's forced deny wins over the alliance path. Leader 2 (owner of Y, leads A2 which holds Z): a
-- forced deny on audit.read in Z removes it there (Worker-facing club_my_permissions, RLS-backed club_activity and
-- direct RPC), leaves members.read and every other club as they were, and lifting it restores the read at once. The
-- leader's join decisions are untouched. An owner who leads their own club's alliance cannot pass a forced deny on to
-- admins either.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000af02','d0ddb226-a10a-471c-be4b-d5e5153bd313','sa deny','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000ac02','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000af02');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000af02');
create function pg_temp.as_sa() returns void language sql as $$ select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ac02"}',true) $$;
set local role authenticated;
do $$ declare z uuid:=pg_temp.c('z'); y uuid:=pg_temp.c('y'); a2 uuid:=pg_temp.alliance_of('z'); begin
 if pg_temp.perms(2,'z')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Fixture: leader 2 should read Z'; end if;
 -- Only the active Super Admin sets it; only a deny is accepted for a leader without a club role there.
 perform pg_temp.as_pa();perform pg_temp.refused(format($q$select public.platform_set_personal_permission(%L,%L,'audit.read',false)$q$,z,pg_temp.u(2)),'42501');
 perform pg_temp.as_sa();
 perform pg_temp.refused(format($q$select public.platform_set_personal_permission(%L,%L,'audit.read',true)$q$,z,pg_temp.u(2)),'PT409');
 perform pg_temp.refused(format($q$select public.platform_set_personal_permission(%L,%L,'audit.read',false)$q$,z,pg_temp.u(7)),'PT409'); -- no role, no alliance
 perform public.platform_set_personal_permission(z,pg_temp.u(2),'audit.read',false);
 if pg_temp.perms(2,'z')<>array['dragon.read','events.read','highland.read','members.read'] then raise exception 'Forced deny bypassed through the alliance: %',pg_temp.perms(2,'z'); end if;
 perform pg_temp.as_user(2);
 if jsonb_array_length(public.club_activity(z)->'events')<>0 then raise exception 'Club log still readable through the alliance'; end if;
 if not exists(select 1 from public.club_players where club_id=z) then raise exception 'Unrelated alliance read lost'; end if;
 if not ('club.rename'=any(pg_temp.perms(2,'y'))) then raise exception 'Owner powers in own club changed'; end if;
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(z,pg_temp.u(2),'audit.read',null);
end $$;
do $$ declare z uuid:=pg_temp.c('z'); a2 uuid:=pg_temp.alliance_of('z'); w uuid:=pg_temp.c('w'); begin
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(z,pg_temp.u(2),'audit.read',false);
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(w,null);
 perform pg_temp.as_user(4);perform public.club_request_alliance(w,a2);
 perform pg_temp.as_user(2);
 if jsonb_array_length(public.club_my_alliance()->'requests')<>1 then raise exception 'Leader lost the request list'; end if;
 perform public.alliance_decide_request(pg_temp.request_of('w'),'approve');
 if pg_temp.perms(2,'w')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Normal alliance reads affected by a deny elsewhere'; end if;
 -- Join decisions work while a deny is in force, and lifting it restores the read on the next statement.
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(z,pg_temp.u(2),'audit.read',false);
 if pg_temp.perms(2,'z')<>array['dragon.read','events.read','highland.read','members.read'] then raise exception 'Deny not applied'; end if;
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(z,pg_temp.u(2),'audit.read',null);
 if pg_temp.perms(2,'z')<>array['audit.read','dragon.read','events.read','highland.read','members.read'] then raise exception 'Lifting the deny did not restore the read'; end if;
 -- Owner who also leads their own club's alliance: a forced deny there holds, and cannot be handed to admins.
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(pg_temp.c('y'),a2);
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(pg_temp.c('y'),pg_temp.u(2),'audit.read',false);
 if 'audit.read'=any(pg_temp.perms(2,'y')) then raise exception 'Owner+leader regained a forced-denied read in own club'; end if;
 perform pg_temp.as_user(2);
 perform pg_temp.refused(format($q$select public.club_set_admin_default(%L,'audit.read',true)$q$,pg_temp.c('y')),'42501');
 perform pg_temp.as_sa();perform public.platform_set_personal_permission(pg_temp.c('y'),pg_temp.u(2),'audit.read',null);
end $$;
reset role;

-- 8. Review fix: a Super Admin who leads an alliance. Their decisions must not let a platform admin match the
-- alliance (and so its leader's email in platform_alliances) to the Super Admin.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000af01','d0ddb226-a10a-471c-be4b-d5e5153bd313','sa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000ac01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000af01');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000af01');
set local role authenticated;
do $$ declare a3 uuid; e jsonb; sa text:='d0ddb226-a10a-471c-be4b-d5e5153bd313'; begin
 perform pg_temp.as_pa();
 a3:=(select (x->>'id')::uuid from jsonb_array_elements(public.platform_alliances()->'alliances') x where x->>'name'='Alliance Three');
 perform public.platform_set_alliance_leader(a3,'owner@club.test','grant');
 perform pg_temp.as_pa();perform public.platform_set_club_alliance(pg_temp.c('w'),null);
 perform pg_temp.as_user(4);perform public.club_request_alliance(pg_temp.c('w'),a3);
 -- The Super Admin decides as that alliance's leader (aal1 is enough: leading needs no MFA).
 perform set_config('request.jwt.claim.sub',sa,true);perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 perform public.alliance_decide_request(pg_temp.request_of('w'),'approve');
 perform pg_temp.as_pa();
 for e in select value from pg_temp.all_events() value where value->>'actor_kind'='super_admin' loop
  if e->'club'<>'null'::jsonb or e->'subject'<>'null'::jsonb or e::text like '%'||a3::text||'%' or e::text like '%'||pg_temp.c('w')::text||'%' or e::text like '%'||sa||'%'
   then raise exception 'Super Admin event lets a platform admin match the alliance or club: %',e; end if;
 end loop;
 if not exists(select 1 from pg_temp.all_events() value where value->>'actor_kind'='super_admin' and value->>'action' like 'club_alliance%') then raise exception 'Decision events missing (check would pass vacuously)'; end if;
 -- Events by others keep their club, so the platform log stays useful.
 if not exists(select 1 from pg_temp.all_events() value where value->>'actor_kind' is null and value->>'club' is not null) then raise exception 'Other events lost their club'; end if;
 -- The active Super Admin still sees everything.
 perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ac01"}',true);perform set_config('request.jwt.claim.sub',sa,true);
 if not exists(select 1 from pg_temp.all_events() value where value->>'actor_kind'='super_admin' and value->>'club' is not null) then raise exception 'Super Admin lost the full record'; end if;
end $$;
reset role;
do $$ begin
 -- The club log records the decision for the club's own readers.
 if not exists(select 1 from public.club_audit_events where club_id=md5('al-club-w')::uuid and action='alliance_joined') or not exists(select 1 from public.club_audit_events where club_id=md5('al-club-w')::uuid and action='alliance_request_rejected')
  then raise exception 'Decisions missing from the club log'; end if;
end $$;
select 'alliances: read-only alliance path within one alliance, no raw imports or emails, owner powers kept, join requests decided by that leader only, platform management audited, immediate effect of every change passed' as result;
