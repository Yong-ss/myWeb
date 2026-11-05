-- Disposable PostgreSQL only. Stage G: removing an account from every club, and the explanation of alliance reads.
-- Why it matters: one confirmation touches many clubs, so it must be the Super Admin's alone, all or nothing, never
-- leave a club without its owner, never touch another account or identity, and apply at once.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000bf01','d0ddb226-a10a-471c-be4b-d5e5153bd313','g sa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000bc01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000bf01');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000bf01');
insert into auth.users(id,email,email_confirmed_at) select md5('g-user-'||n)::uuid,'g-'||n||'@fixture.invalid',now() from generate_series(1,6)n;
insert into public.club_clubs(id,name) select md5('g-club-'||c)::uuid,'G club '||c from unnest(array['x','y','z'])c;
-- 1: admin in X and Y, also platform admin and alliance leader; 2: admin in X, owner of Z; 3: owner of X and Y;
-- 4: no club role; 5: platform admin with own factor (the caller in refusals); 6: admin in Y (bystander).
insert into public.club_memberships(club_id,user_id,role) values
 (md5('g-club-x')::uuid,md5('g-user-1')::uuid,'admin'),(md5('g-club-y')::uuid,md5('g-user-1')::uuid,'admin'),
 (md5('g-club-x')::uuid,md5('g-user-2')::uuid,'admin'),(md5('g-club-z')::uuid,md5('g-user-2')::uuid,'owner'),
 (md5('g-club-x')::uuid,md5('g-user-3')::uuid,'owner'),(md5('g-club-y')::uuid,md5('g-user-3')::uuid,'owner'),
 (md5('g-club-y')::uuid,md5('g-user-6')::uuid,'admin');
insert into public.platform_role_assignments(user_id,role) values (md5('g-user-1')::uuid,'platform_admin'),(md5('g-user-5')::uuid,'platform_admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000bf05',md5('g-user-5')::uuid,'g pa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000bc05',md5('g-user-5')::uuid,'aal2','00000000-0000-4000-8000-00000000bf05');
insert into public.club_alliances(id,name) values (md5('g-alliance')::uuid,'G alliance');
insert into public.club_alliance_members(alliance_id,club_id) values (md5('g-alliance')::uuid,md5('g-club-z')::uuid);
insert into public.alliance_leaders(alliance_id,user_id) values (md5('g-alliance')::uuid,md5('g-user-1')::uuid);
insert into public.club_players(id,club_id,display_name,match_name) values (md5('g-player')::uuid,md5('g-club-x')::uuid,'G player','G player');
insert into public.club_permission_overrides(club_id,user_id,permission_key,set_by,allowed) values (md5('g-club-x')::uuid,md5('g-user-1')::uuid,'imports.delete','super_admin',false);

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('g-user-'||n)::uuid $$;
create function pg_temp.c(x text) returns uuid language sql as $$ select md5('g-club-'||x)::uuid $$;
create function pg_temp.as_sa() returns void language sql as $$ select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000bc01"}',true) $$;
-- Fixture readers as the table owner.
create function pg_temp.roles(n int) returns text language sql security definer as $$
 select coalesce(string_agg(c.name||':'||m.role,',' order by c.name),'') from public.club_memberships m join public.club_clubs c on c.id=m.club_id where m.user_id=md5('g-user-'||n)::uuid and m.status='active' $$;
create function pg_temp.expected(n int) returns jsonb language sql security definer as $$
 select coalesce(jsonb_object_agg(m.club_id::text,c.role_version),'{}'::jsonb) from public.club_memberships m join public.club_clubs c on c.id=m.club_id where m.user_id=md5('g-user-'||n)::uuid and m.status='active' $$;
create function pg_temp.remove(n int,expected jsonb,request uuid default gen_random_uuid()) returns jsonb language sql as $$ select public.platform_remove_from_all_clubs(md5('g-user-'||n)::uuid,expected,request) $$;
create function pg_temp.refused(sql text,code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then if sqlstate<>code then raise exception '% failed with % (%), expected %',sql,sqlstate,sqlerrm,code; end if; return; end;
 raise exception '% was allowed',sql;
end $$;

set local role authenticated;
-- 1. Only the active Super Admin: not a platform admin, not an owner, not the Super Admin without MFA.
do $$ declare e jsonb:=pg_temp.expected(1); begin
 perform set_config('request.jwt.claim.sub',md5('g-user-5')::text,true);perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000bc05"}',true);
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e),'42501');
 perform set_config('request.jwt.claim.sub',md5('g-user-3')::text,true);perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e),'42501');
 perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e),'42501');
 if pg_temp.roles(1)<>'G club x:admin,G club y:admin' then raise exception 'A refused call changed roles'; end if;
end $$;

-- 2. All or nothing: an owner anywhere is refused, with the clubs named, and nothing changes.
do $$ declare msg text; begin
 perform pg_temp.as_sa();
 begin perform pg_temp.remove(2,pg_temp.expected(2)); raise exception 'Owner removal allowed';
 exception when sqlstate 'PT409' then get stacked diagnostics msg=message_text; end;
 if msg not like '%G club z%' or msg not like '%请先转让公会长%' then raise exception 'Owner refusal unclear: %',msg; end if;
 if pg_temp.roles(2)<>'G club x:admin,G club z:owner' then raise exception 'Owner refusal changed roles'; end if;
 perform pg_temp.refused(format('select pg_temp.remove(3,%L)',pg_temp.expected(3)),'PT409');
end $$;

-- 3. The preview must match exactly: a stale version, a missing club or another club refuse the whole removal.
do $$ declare e jsonb; begin
 perform pg_temp.as_sa();e:=pg_temp.expected(1);
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e||jsonb_build_object(pg_temp.c('x')::text,(e->>pg_temp.c('x')::text)::int+1)),'PT409');
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e-pg_temp.c('y')::text),'PT409');
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)',e||jsonb_build_object(pg_temp.c('z')::text,0)),'PT409');
 perform pg_temp.refused(format('select pg_temp.remove(1,%L)','[]'),'22023');
 perform pg_temp.refused(format('select public.platform_remove_from_all_clubs(%L,%L,gen_random_uuid())',gen_random_uuid(),'{}'),'22023');
 if pg_temp.roles(1)<>'G club x:admin,G club y:admin' then raise exception 'A refused removal changed roles'; end if;
end $$;

-- 4. Success: every club role of this account only, at once; account, identities, settings and history stay.
do $$ declare r jsonb; req uuid:=gen_random_uuid(); e jsonb; before jsonb; begin
 perform pg_temp.as_sa();e:=pg_temp.expected(1);
 r:=pg_temp.remove(1,e,req);
 if not (r->>'changed')::boolean or jsonb_array_length(r->'clubs')<>2 then raise exception 'Removal result wrong: %',r; end if;
 -- Replay: same answer, nothing more; the same id with another payload is refused.
 if pg_temp.remove(1,e,req)<>r then raise exception 'Replay differs'; end if;
 perform pg_temp.refused(format('select pg_temp.remove(1,%L,%L)','{}',req),'PT409');
 if (pg_temp.remove(4,'{}')->>'changed')::boolean then raise exception 'No-role account changed'; end if;
end $$;
reset role;
do $$ begin
 if pg_temp.roles(1)<>'' then raise exception 'Roles left: %',pg_temp.roles(1); end if;
 if pg_temp.roles(6)<>'G club y:admin' or pg_temp.roles(3)<>'G club x:owner,G club y:owner' or pg_temp.roles(2)<>'G club x:admin,G club z:owner' then raise exception 'Another account was touched'; end if;
 if not exists(select 1 from auth.users where id=md5('g-user-1')::uuid) then raise exception 'Account deleted'; end if;
 if (select status from public.platform_role_assignments where user_id=md5('g-user-1')::uuid)<>'active' then raise exception 'Platform identity touched'; end if;
 if (select status from public.alliance_leaders where user_id=md5('g-user-1')::uuid)<>'active' then raise exception 'Alliance identity touched'; end if;
 if not exists(select 1 from public.club_permission_overrides where user_id=md5('g-user-1')::uuid) or not exists(select 1 from public.club_players where id=md5('g-player')::uuid) then raise exception 'History or settings removed'; end if;
 if (select count(*) from public.club_memberships where user_id=md5('g-user-1')::uuid and status='revoked')<>2 then raise exception 'History of roles not kept'; end if;
 if (select count(*) from public.platform_audit_events where actor_id='d0ddb226-a10a-471c-be4b-d5e5153bd313' and action='club_memberships.update' and details#>>'{new,user_id}'=md5('g-user-1')::uuid::text and details#>>'{new,status}'='revoked')<>2
  then raise exception 'Removal not audited per club'; end if;
end $$;
set local role authenticated;
do $$ begin
 -- Immediately: no club powers left there; the alliance read (Z) and platform powers are unchanged.
 perform set_config('request.jwt.claim.sub',md5('g-user-1')::text,true);perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 if public.club_my_permissions(pg_temp.c('x'))<>'{}' or public.club_my_permissions(pg_temp.c('y'))<>'{}' then raise exception 'Removed roles still grant access'; end if;
 if public.club_my_permissions(pg_temp.c('z'))<>array['audit.read','events.read','highland.read','members.read'] then raise exception 'Alliance read lost by the removal'; end if;
end $$;

-- 5. The explanation for a leader with no club role shows the alliance read, and a forced deny in it.
do $$ declare e jsonb; p jsonb; begin
 perform pg_temp.as_sa();
 e:=public.platform_permission_explain(pg_temp.c('z'),pg_temp.u(1));
 if not (e->>'alliance_leader')::boolean or e->>'role' is not null then raise exception 'Explain lacks the alliance: %',e; end if;
 p:=(select x from jsonb_array_elements(e->'permissions') x where x->>'key'='members.read');
 if not (p->>'alliance')::boolean or not (p->>'allowed')::boolean then raise exception 'Alliance read not explained: %',p; end if;
 if ((select x from jsonb_array_elements(e->'permissions') x where x->>'key'='imports.create')->>'allowed')::boolean then raise exception 'Write shown as allowed'; end if;
 perform public.platform_set_personal_permission(pg_temp.c('z'),pg_temp.u(1),'members.read',false);
 p:=(select x from jsonb_array_elements(public.platform_permission_explain(pg_temp.c('z'),pg_temp.u(1))->'permissions') x where x->>'key'='members.read');
 if (p->>'allowed')::boolean or (p->>'forced')::boolean is distinct from false then raise exception 'Forced deny not explained: %',p; end if;
 -- The explanation equals can() for that account.
 perform set_config('request.jwt.claim.sub',md5('g-user-1')::text,true);perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 if public.club_my_permissions(pg_temp.c('z'))<>array['audit.read','events.read','highland.read'] then raise exception 'can() and explanation disagree'; end if;
 -- The user list names the alliance and its clubs, so the Super Admin can find this account.
 perform pg_temp.as_sa();
 if (select u->'alliance'->>'name' from jsonb_array_elements(public.platform_users('g-1@')->'users') u)<>'G alliance' then raise exception 'Leader not findable'; end if;
end $$;
reset role;
select 'bulk_removal: Super Admin only, all or nothing, owners refused, exact preview, replay safe, only this account, identities and history kept, immediate, alliance explanation passed' as result;
