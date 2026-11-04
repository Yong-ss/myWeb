-- Disposable PostgreSQL only. Stage E: platform admins. Everything rolls back after this suite.
-- Why it matters: a platform admin manages club roles for the whole platform, so their powers must need a real TOTP
-- session, stop at once on revocation, never include Super-Admin-only powers, and never reveal who the Super Admin is.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Super Admin with a confirmed device (the existing mechanism).
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000fe01','d0ddb226-a10a-471c-be4b-d5e5153bd313','pa fixture sa','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000ce01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000fe01');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000fe01');
insert into auth.users(id,email,email_confirmed_at) select md5('pa-user-'||n)::uuid,'pa-'||n||'@fixture.invalid',case when n=6 then null else now() end from generate_series(1,6)n;
-- pa-1: platform admin with a verified factor (never confirmed in SQL Editor); pa-2: only an unverified factor.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000fe11',md5('pa-user-1')::uuid,'pa own','totp','verified'),
 ('00000000-0000-4000-8000-00000000fe12',md5('pa-user-2')::uuid,'pa unverified','totp','unverified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000ce11',md5('pa-user-1')::uuid,'aal2','00000000-0000-4000-8000-00000000fe11'),
 ('00000000-0000-4000-8000-00000000ce12',md5('pa-user-2')::uuid,'aal2','00000000-0000-4000-8000-00000000fe12');
insert into public.club_clubs(id,name) values(md5('pa-club')::uuid,'PA fixture'),(md5('pa-club-2')::uuid,'PA owned');

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('pa-user-'||n)::uuid $$;
create function pg_temp.as_sa() returns void language sql as $$
 select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ce01"}',true);
$$;
create function pg_temp.as_user(n int,claims text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',md5('pa-user-'||n)::text,true),set_config('request.jwt.claims',claims,true);
$$;
create function pg_temp.as_pa() returns void language sql as $$ select pg_temp.as_user(1,'{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ce11"}') $$;
create function pg_temp.perms() returns jsonb language sql as $$ select public.club_my_access(md5('pa-club')::uuid)->'platform_permissions' $$;
-- Fixture readers run as the table owner: a platform admin has no club access, so RLS would hide these rows.
create function pg_temp.ver() returns bigint language sql security definer as $$ select role_version from public.club_clubs where id=md5('pa-club')::uuid $$;
create function pg_temp.held(u uuid) returns text language sql security definer as $$
 select coalesce(string_agg(role,','),'') from public.club_memberships where club_id=md5('pa-club')::uuid and user_id=u and status='active';
$$;
-- Every page of the log: one test transaction gives every event the same time, so a single page is an arbitrary 50.
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

-- 1. Registry: the role exists with exactly two permissions; Super-Admin-only powers can never reach any role.
do $$ begin
 if (select array_agg(permission_key order by permission_key) from public.auth_role_permissions where role_key='platform_admin')<>array['platform.alliance_leaders.assign','platform.alliances.manage','platform.events.permissions','platform.read','platform.roles.assign']
  then raise exception 'Platform admin permissions wrong'; end if;
 if (select array_agg(key order by key) from public.auth_permissions where super_admin_only)<>array['platform.clubs.admin_limit','platform.permissions.manage','platform.platform_admins.assign','platform.users.remove_all_clubs']
  then raise exception 'Super-Admin-only set wrong'; end if;
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('platform_admin','platform.permissions.manage')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('platform_admin','platform.platform_admins.assign')$q$,'23514');
 perform pg_temp.refused($q$insert into public.auth_role_permissions values('owner','platform.clubs.admin_limit')$q$,'23514');
 perform pg_temp.refused($q$update public.auth_permissions set super_admin_only=false where key='platform.permissions.manage'$q$,'23514');
 -- A club role can never be a platform assignment, nor a platform role a club membership.
 perform pg_temp.refused(format($q$insert into public.platform_role_assignments(user_id,role) values(%L,'owner')$q$,pg_temp.u(3)),'23514');
 perform pg_temp.refused(format($q$insert into public.club_memberships(club_id,user_id,role) values(%L,%L,'platform_admin')$q$,md5('pa-club')::uuid,pg_temp.u(3)),'23514');
end $$;

set local role authenticated;
-- 2. Only the active Super Admin appoints; the table itself is closed to clients.
do $$ begin
 perform pg_temp.refused('select * from public.platform_role_assignments','42501');
 perform pg_temp.as_user(1,'{"aal":"aal1"}');
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(1),'grant'),'42501');
 -- Super Admin on aal1: not active, refused too.
 perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(1),'grant'),'42501');
 perform pg_temp.as_sa();
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(6),'grant'),'22023'); -- unconfirmed email
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',gen_random_uuid(),'grant'),'22023');
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)','d0ddb226-a10a-471c-be4b-d5e5153bd313','grant'),'PT409');
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(1),'promote'),'22023');
 if not (public.platform_set_platform_admin(pg_temp.u(1),'grant')->>'changed')::boolean then raise exception 'Grant not applied'; end if;
 if (public.platform_set_platform_admin(pg_temp.u(1),'grant')->>'changed')::boolean then raise exception 'Repeat grant changed something'; end if;
 perform public.platform_set_platform_admin(pg_temp.u(2),'grant');
 -- Super Admin powers are unchanged, and include the new appointment power.
 if pg_temp.perms()<>'["audit.actor_email.read","audit.read","members.read","platform.alliance_leaders.assign","platform.alliances.manage","platform.clubs.admin_limit","platform.events.permissions","platform.permissions.manage","platform.platform_admins.assign","platform.read","platform.roles.assign","platform.users.remove_all_clubs"]' then raise exception 'Super Admin permissions changed: %',pg_temp.perms(); end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.platform_audit_events where action='platform_role_assignments.insert' and actor_id='d0ddb226-a10a-471c-be4b-d5e5153bd313' and details#>>'{new,user_id}'=md5('pa-user-1')::uuid::text)<>1
  then raise exception 'Appointment not audited once'; end if;
end $$;

set local role authenticated;
-- 3. Powers need aal2 from the account's own verified TOTP factor; no SQL Editor confirmation, no club powers.
do $$ declare r jsonb; begin
 perform pg_temp.as_user(1,'{"aal":"aal1"}');
 r:=public.club_my_access(md5('pa-club')::uuid);
 if r->'platform_permissions'<>'[]' or not (r->>'platform_admin')::boolean or (r->>'platform_admin_active')::boolean then raise exception 'aal1 platform admin wrong: %',r; end if;
 perform pg_temp.refused('select public.platform_overview()','42501');
 perform pg_temp.as_user(1,'{"aal":"aal2"}'); -- no session id
 if pg_temp.perms()<>'[]' then raise exception 'aal2 claim without a session granted powers'; end if;
 perform pg_temp.as_user(1,'{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ce12"}'); -- another user's session
 if pg_temp.perms()<>'[]' then raise exception 'Another session granted powers'; end if;
 perform pg_temp.as_user(2,'{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ce12"}'); -- unverified factor
 if pg_temp.perms()<>'[]' then raise exception 'Unverified factor granted powers'; end if;
 perform pg_temp.as_pa();
 r:=public.club_my_access(md5('pa-club')::uuid);
 if r->'platform_permissions'<>'["platform.alliance_leaders.assign","platform.alliances.manage","platform.events.permissions","platform.read","platform.roles.assign"]' or not (r->>'platform_admin_active')::boolean or (r->>'super_admin_active')::boolean then raise exception 'Active platform admin wrong: %',r; end if;
 if r->'permissions'<>'[]' then raise exception 'Platform admin gained club permissions'; end if;
 perform public.platform_overview();perform public.platform_roles();perform public.platform_permission_settings(null);
end $$;

-- 4. Never: admin limit, any permission layer, platform admin appointments, Super Admin list or the logs.
do $$ declare c uuid:=md5('pa-club')::uuid; begin
 perform pg_temp.as_pa();
 perform pg_temp.refused(format('select public.platform_set_admin_limit(%L,1)',c),'42501');
 perform pg_temp.refused($q$select public.platform_set_role_permission('platform_default','admin','club.rename',true)$q$,'42501');
 perform pg_temp.refused($q$select public.platform_set_role_permission('cap','admin','imports.delete',false)$q$,'42501');
 perform pg_temp.refused(format($q$select public.platform_set_role_permission('club_default','admin','club.rename',true,%L)$q$,c),'42501');
 perform pg_temp.refused(format($q$select public.platform_set_personal_permission(%L,%L,'members.read',false)$q$,c,pg_temp.u(3)),'42501');
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(3),'grant'),'42501');
 perform pg_temp.refused(format('select public.platform_set_platform_admin(%L,%L)',pg_temp.u(2),'revoke'),'42501');
 perform pg_temp.refused(format($q$insert into public.platform_super_admins(user_id) values(%L)$q$,pg_temp.u(1)),'42501');
 perform pg_temp.refused('delete from public.platform_audit_events','42501');
 perform pg_temp.refused('select club_private.trust_super_admin_factor(''00000000-0000-4000-8000-00000000fe11'')','42501');
end $$;
reset role;
do $$ begin
 if (select admin_limit from public.club_clubs where id=md5('pa-club')::uuid)<>5 or exists(select 1 from public.club_role_permissions) or exists(select 1 from public.club_permission_overrides)
  or (select status from public.platform_role_assignments where user_id=md5('pa-user-2')::uuid)<>'active' or exists(select 1 from public.platform_super_admins where user_id=md5('pa-user-1')::uuid)
  then raise exception 'A refused platform admin call changed data'; end if;
end $$;

set local role authenticated;
-- 5. Club roles through the same transaction: owner, admins within the limit, transfer, remove; never their own.
do $$ declare c uuid:=md5('pa-club')::uuid; begin
 perform pg_temp.as_pa();
 perform public.platform_assign_role(c,pg_temp.u(3),'owner','grant',pg_temp.ver(),gen_random_uuid());
 perform public.platform_assign_role(c,pg_temp.u(4),'admin','grant',pg_temp.ver(),gen_random_uuid());
 if pg_temp.held(pg_temp.u(3))<>'owner' or pg_temp.held(pg_temp.u(4))<>'admin' then raise exception 'Platform admin grants not applied'; end if;
 perform pg_temp.refused(format('select public.platform_assign_role(%L,%L,%L,%L,%s,gen_random_uuid())',c,pg_temp.u(1),'owner','grant',pg_temp.ver()),'42501');
 perform pg_temp.refused(format('select public.platform_assign_role(%L,%L,%L,%L,%s,gen_random_uuid())',c,pg_temp.u(1),'admin','grant',pg_temp.ver()),'42501');
 if pg_temp.held(pg_temp.u(1))<>'' then raise exception 'Platform admin promoted themselves'; end if;
 perform pg_temp.as_sa();perform public.platform_set_admin_limit(c,1);perform pg_temp.as_pa();
 perform pg_temp.refused(format('select public.platform_assign_role(%L,%L,%L,%L,%s,gen_random_uuid())',c,pg_temp.u(5),'admin','grant',pg_temp.ver()),'PT409');
 perform pg_temp.refused(format('select public.platform_transfer_owner(%L,%L,%L,%s,gen_random_uuid())',c,pg_temp.u(5),'admin',pg_temp.ver()),'PT409'); -- old owner as admin exceeds 1
 perform public.platform_transfer_owner(c,pg_temp.u(4),'leave',pg_temp.ver(),gen_random_uuid());
 if pg_temp.held(pg_temp.u(4))<>'owner' or pg_temp.held(pg_temp.u(3))<>'' then raise exception 'Transfer wrong'; end if;
 perform public.platform_assign_role(c,pg_temp.u(5),'admin','grant',pg_temp.ver(),gen_random_uuid());
 perform public.platform_assign_role(c,pg_temp.u(5),'admin','revoke',pg_temp.ver(),gen_random_uuid());
 perform public.platform_assign_role(c,pg_temp.u(5),'admin','grant',pg_temp.ver(),gen_random_uuid());
 perform public.platform_remove_from_club(c,pg_temp.u(5),pg_temp.ver(),gen_random_uuid());
 if pg_temp.held(pg_temp.u(5))<>'' then raise exception 'Remove failed'; end if;
 if jsonb_array_length(public.platform_role_context(pg_temp.u(4))->'clubs')<1 then raise exception 'Role context unavailable'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.platform_audit_events where actor_id=md5('pa-user-1')::uuid and action like 'club_memberships.%')<4 then raise exception 'Platform admin changes not audited with their identity'; end if;
end $$;

set local role authenticated;
-- 6. The Super Admin's identity is hidden from a platform admin: no flag, no device or list events, no actor email.
do $$ declare page jsonb; e jsonb; begin
 perform pg_temp.as_pa();
 page:=public.platform_users();
 if exists(select 1 from jsonb_array_elements(page->'users') u where u.value ? 'super_admin') then raise exception 'Super Admin flag shown to a platform admin'; end if;
 if not exists(select 1 from jsonb_array_elements(page->'users') u where u.value->>'id'=md5('pa-user-2')::uuid::text and (u.value->>'platform_admin')::boolean) then raise exception 'Platform admin flag missing'; end if;
 page:=public.platform_activity();
 if exists(select 1 from jsonb_array_elements(page->'events') e where e.value->>'action' like 'platform\_super\_admin%') then raise exception 'Super Admin device or list event shown'; end if;
 e:=(select value from jsonb_array_elements(page->'events') where value->>'action'='platform_role_assignments.insert' limit 1);
 if e->'actor'<>'null'::jsonb or e->>'actor_kind'<>'super_admin' then raise exception 'Super Admin actor exposed: %',e; end if;
 if public.platform_permission_explain(md5('pa-club')::uuid,'d0ddb226-a10a-471c-be4b-d5e5153bd313') ? 'super_admin' then raise exception 'Explain exposes the Super Admin'; end if;
 -- Changing a Super Admin account's club role answers exactly like any other account (nothing to tell them apart).
 perform public.platform_assign_role(md5('pa-club')::uuid,'d0ddb226-a10a-471c-be4b-d5e5153bd313','admin','grant',pg_temp.ver(),gen_random_uuid());
 if pg_temp.held('d0ddb226-a10a-471c-be4b-d5e5153bd313')<>'admin' then raise exception 'Role change on that account behaved differently'; end if;
 -- The active Super Admin still sees everything.
 perform pg_temp.as_sa();
 if not exists(select 1 from jsonb_array_elements(public.platform_users()->'users') u where (u.value->>'super_admin')::boolean) then raise exception 'Super Admin lost the flag'; end if;
 if not exists(select 1 from jsonb_array_elements(public.platform_activity()->'events') e where e.value->>'action' like 'platform\_super\_admin%') then raise exception 'Super Admin lost device events'; end if;
 if (select value->>'actor' from jsonb_array_elements(public.platform_activity()->'events') where value->>'action'='platform_role_assignments.insert' limit 1) is null then raise exception 'Super Admin lost actor emails'; end if;
end $$;

-- 6a. The Super Admin changing their own club role must not be matchable either: no field of any event they made, and
-- no membership time, carries their id or email for a platform admin. The Super Admin still sees every field.
do $$ declare sa uuid:='d0ddb226-a10a-471c-be4b-d5e5153bd313'; sa_email text; e jsonb; mine jsonb; begin
 perform pg_temp.as_sa();
 perform public.platform_assign_role(md5('pa-club')::uuid,sa,'admin','revoke',pg_temp.ver(),gen_random_uuid());
 perform public.platform_assign_role(md5('pa-club')::uuid,sa,'admin','grant',pg_temp.ver(),gen_random_uuid());
 perform public.platform_assign_role(md5('pa-club')::uuid,sa,'admin','grant',pg_temp.ver(),gen_random_uuid()); -- noop event
 sa_email:=(select u.value->>'email' from jsonb_array_elements(public.platform_users()->'users') u where (u.value->>'id')::uuid=sa);
 mine:=(select value from pg_temp.all_events() value where value->>'subject'=sa_email and value->>'action'='club_memberships.update' limit 1);
 if mine is null or mine#>>'{details,new,user_id}'<>sa::text then raise exception 'Super Admin lost the full record: %',mine; end if;
 perform pg_temp.as_pa();
 for e in select value from pg_temp.all_events() value where value->>'actor_kind'='super_admin' loop
  if e::text like '%'||sa::text||'%' or e::text like '%'||sa_email||'%' then raise exception 'Super Admin event carries their identity: %',e; end if;
  if e->'subject'<>'null'::jsonb or e->'details' @? '$.**.user_id' or e->'details' @? '$.**.created_at' then raise exception 'Super Admin event keeps an identifier: %',e; end if;
 end loop;
 if not exists(select 1 from pg_temp.all_events() value where value->>'actor_kind'='super_admin' and value->>'action' in ('club_memberships.update','club_memberships.noop'))
  then raise exception 'Self-change events missing (the check above would pass vacuously)'; end if;
 -- Membership times would match those events.
 if exists(select 1 from jsonb_array_elements(public.platform_users()->'users') u, jsonb_array_elements(u.value->'memberships') m where m.value ? 'created_at') then raise exception 'Membership time shown to a platform admin'; end if;
 -- Events by others keep their affected user: the masking is only for the Super Admin's events.
 if not exists(select 1 from pg_temp.all_events() value where value->>'actor' is not null and value->>'subject' is not null) then raise exception 'Other events lost their subject'; end if;
 perform pg_temp.as_sa();
 if not exists(select 1 from jsonb_array_elements(public.platform_users()->'users') u, jsonb_array_elements(u.value->'memberships') m where m.value ? 'created_at') then raise exception 'Super Admin lost membership times'; end if;
end $$;
reset role;
do $$ begin
 -- The stored records are untouched.
 if not exists(select 1 from public.platform_audit_events where actor_id='d0ddb226-a10a-471c-be4b-d5e5153bd313' and details#>>'{new,user_id}'='d0ddb226-a10a-471c-be4b-d5e5153bd313') then raise exception 'Stored audit changed'; end if;
end $$;
set local role authenticated;

-- 6b. Review fixes. A platform admin who owns a club: cannot transfer their own ownership away (no changes to their
-- own club role by any route), and their owner-route admin changes reach the club log like any owner's.
do $$ declare c2 uuid:=md5('pa-club-2')::uuid; begin
 perform pg_temp.as_sa();
 perform public.platform_assign_role(c2,pg_temp.u(1),'owner','grant',(select role_version from public.club_clubs where id=c2),gen_random_uuid());
 perform pg_temp.as_pa();
 perform pg_temp.refused(format('select public.platform_transfer_owner(%L,%L,%L,(select role_version from public.club_clubs where id=%L),gen_random_uuid())',c2,pg_temp.u(5),'admin',c2),'42501');
 perform pg_temp.refused(format('select public.platform_transfer_owner(%L,%L,%L,(select role_version from public.club_clubs where id=%L),gen_random_uuid())',c2,pg_temp.u(5),'leave',c2),'42501');
 perform public.club_change_admin(c2,pg_temp.u(5),'grant',(select role_version from public.club_clubs where id=c2),gen_random_uuid());
end $$;
reset role;
do $$ begin
 if (select string_agg(role,',') from public.club_memberships where club_id=md5('pa-club-2')::uuid and user_id=md5('pa-user-1')::uuid and status='active')<>'owner' then raise exception 'Own ownership changed'; end if;
 if not exists(select 1 from public.club_audit_events where club_id=md5('pa-club-2')::uuid and actor_id=md5('pa-user-1')::uuid and action='admin_appointed' and target_id=md5('pa-user-5')::uuid) then raise exception 'Owner-route change by a platform admin missing from the club log'; end if;
end $$;
set local role authenticated;

-- 7. Revocation applies to the next statement; history is kept.
do $$ begin
 perform pg_temp.as_sa();perform public.platform_set_platform_admin(pg_temp.u(1),'revoke');
 perform pg_temp.as_pa();
 if pg_temp.perms()<>'[]' then raise exception 'Revoked platform admin kept powers'; end if;
 perform pg_temp.refused('select public.platform_overview()','42501');
 perform pg_temp.refused(format('select public.platform_assign_role(%L,%L,%L,%L,%s,gen_random_uuid())',md5('pa-club')::uuid,pg_temp.u(3),'admin','grant',pg_temp.ver()),'42501');
 if (public.club_my_access(md5('pa-club')::uuid)->>'platform_admin')::boolean then raise exception 'Revoked account still listed'; end if;
end $$;
reset role;
do $$ begin
 if (select status from public.platform_role_assignments where user_id=md5('pa-user-1')::uuid)<>'revoked' then raise exception 'History not kept'; end if;
 -- The account context lists no new field; the active platform admin's permissions appear there through can_platform().
 if exists(select 1 from pg_proc where proname='club_my_context' and prosrc ~ 'platform_role_assignments') then raise exception 'club_my_context changed'; end if;
 -- Deleting a factor ends the powers of an existing aal2 session too.
 delete from auth.mfa_factors where id='00000000-0000-4000-8000-00000000fe12';
end $$;
set local role authenticated;
do $$ begin
 perform pg_temp.as_user(2,'{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ce12"}');
 if pg_temp.perms()<>'[]' then raise exception 'Session without a factor kept powers'; end if;
 perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;
select 'platform_admins: Super Admin-only appointment, own TOTP session, no Super-Admin-only powers, club roles within limits and never self, identity masking, immediate revocation passed' as result;
