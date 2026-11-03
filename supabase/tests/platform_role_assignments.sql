-- Disposable PostgreSQL only. Every successful assignment and audit rolls back after this suite.
-- Stage A rules: one active role per user per club, explicit owner transfer, remove from one club, Super Admin admin limit.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000f041','d0ddb226-a10a-471c-be4b-d5e5153bd313','roles fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000c041','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f041');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f041');
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c041"}',true);
insert into auth.users(id,email,email_confirmed_at) select md5('p4-user-'||n)::uuid,'p4-'||n||'@fixture.invalid',case when n=8 then null else now() end from generate_series(1,9)n;
insert into public.club_clubs(id,name) values(md5('p4-club')::uuid,'P4 fixture'),(md5('p4-foreign')::uuid,'P4 foreign');

create function pg_temp.u(n int) returns uuid language sql as $$ select md5('p4-user-'||n)::uuid $$;
create function pg_temp.ver(c uuid) returns bigint language sql as $$ select role_version from public.club_clubs where id=c $$;
create function pg_temp.assign_role(c uuid,u uuid,r text,a text) returns jsonb language sql as $$
 select public.platform_assign_role(c,u,r,a,pg_temp.ver(c),gen_random_uuid());
$$;
create function pg_temp.transfer(c uuid,u uuid,prev text) returns jsonb language sql as $$
 select public.platform_transfer_owner(c,u,prev,pg_temp.ver(c),gen_random_uuid());
$$;
create function pg_temp.remove(c uuid,u uuid) returns jsonb language sql as $$
 select public.platform_remove_from_club(c,u,pg_temp.ver(c),gen_random_uuid());
$$;
create function pg_temp.held(c uuid,u uuid) returns text language sql as $$
 select coalesce(string_agg(role,',' order by role),'') from public.club_memberships where club_id=c and user_id=u and status='active';
$$;
create function pg_temp.admins(c uuid) returns bigint language sql as $$
 select count(*) from public.club_memberships where club_id=c and role='admin' and status='active';
$$;
-- Force failure after a transfer has already revoked roles: memberships, version and audit must all roll back.
create function pg_temp.reject_transfer_fixture() returns trigger language plpgsql as $$
begin
 if new.user_id=md5('p4-user-9')::uuid and new.role='owner' then raise check_violation using message='fixture transfer failure'; end if;
 return new;
end $$;
create trigger p4_transfer_fixture before insert or update on public.club_memberships for each row execute function pg_temp.reject_transfer_fixture();

do $$
declare c uuid:=md5('p4-club')::uuid; b uuid:=md5('p4-foreign')::uuid; u1 uuid:=pg_temp.u(1);
 request uuid:=gen_random_uuid(); ver bigint; result jsonb; logs bigint; msg text; i int;
begin
 -- Single role: a second role in the same club is refused with a clear message, never silently added.
 perform pg_temp.assign_role(c,u1,'owner','grant');
 select count(*) into logs from public.platform_audit_events;
 begin perform pg_temp.assign_role(c,u1,'admin','grant');raise exception 'Second role accepted';
 exception when sqlstate 'PT409' then get stacked diagnostics msg=message_text; end;
 if msg not like '%已担任公会长%同一俱乐部只能有一个职位%' then raise exception 'Unclear single-role message: %',msg; end if;
 if pg_temp.held(c,u1)<>'owner' or (select count(*) from public.platform_audit_events)<>logs then raise exception 'Refused grant changed state'; end if;
 -- Different clubs may hold different roles.
 perform pg_temp.assign_role(b,u1,'admin','grant');
 if pg_temp.held(b,u1)<>'admin' then raise exception 'Role in another club refused'; end if;

 -- Admin limit (default 5): reaching it blocks new appointments; re-appointing a revoked admin works within it.
 for i in 2..6 loop perform pg_temp.assign_role(c,pg_temp.u(i),'admin','grant'); end loop;
 select count(*) into logs from public.platform_audit_events;
 begin perform pg_temp.assign_role(c,pg_temp.u(7),'admin','grant');raise exception 'Cap bypassed';exception when sqlstate 'PT409' then null;end;
 if (select count(*) from public.platform_audit_events)<>logs then raise exception 'Failed grant logged'; end if;
 perform pg_temp.assign_role(c,pg_temp.u(6),'admin','revoke');
 perform pg_temp.assign_role(c,pg_temp.u(6),'admin','grant');
 if pg_temp.held(c,pg_temp.u(6))<>'admin' or pg_temp.admins(c)<>5 then raise exception 'Re-appointment failed'; end if;

 -- The owner is never revoked or removed without a successor; no second owner; invalid input refused.
 begin perform pg_temp.assign_role(c,u1,'owner','revoke');raise exception 'Owner revoked';exception when sqlstate 'PT409' then null;end;
 begin perform pg_temp.remove(c,u1);raise exception 'Owner removed';exception when sqlstate 'PT409' then null;end;
 begin perform pg_temp.assign_role(c,pg_temp.u(7),'owner','grant');raise exception 'Second owner allowed';exception when sqlstate 'PT409' then null;end;
 begin perform pg_temp.assign_role(c,pg_temp.u(8),'admin','grant');raise exception 'Unverified grant allowed';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.assign_role(c,u1,'super_admin','grant');raise exception 'Super Admin role accepted';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.transfer(c,pg_temp.u(7),null);raise exception 'Transfer without a choice';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.transfer(c,pg_temp.u(7),'stay');raise exception 'Unknown choice accepted';exception when invalid_parameter_value then null;end;
 begin perform public.platform_remove_from_club(c,null,pg_temp.ver(c),gen_random_uuid());raise exception 'Null user accepted';exception when invalid_parameter_value then null;end;

 -- Transfer keeping the previous owner as admin fails as a whole when that would exceed the limit.
 select count(*) into logs from public.platform_audit_events; ver:=pg_temp.ver(c);
 begin perform pg_temp.transfer(c,pg_temp.u(7),'admin');raise exception 'Transfer exceeded limit';exception when sqlstate 'PT409' then null;end;
 if pg_temp.held(c,u1)<>'owner' or pg_temp.held(c,pg_temp.u(7))<>'' or pg_temp.ver(c)<>ver or (select count(*) from public.platform_audit_events)<>logs then raise exception 'Over-limit transfer not rolled back'; end if;
 -- Successor is an admin: their admin slot is released first, so the previous owner fits as admin.
 perform pg_temp.transfer(c,pg_temp.u(2),'admin');
 if pg_temp.held(c,pg_temp.u(2))<>'owner' or pg_temp.held(c,u1)<>'admin' or pg_temp.admins(c)<>5
   or (select count(*) from public.club_memberships where club_id=c and role='owner' and status='active')<>1 then raise exception 'Transfer to admin, previous stays admin, wrong'; end if;
 -- Previous owner leaves: they keep no role in this club, and their other clubs are untouched.
 perform pg_temp.assign_role(b,pg_temp.u(2),'admin','grant');
 perform pg_temp.transfer(c,pg_temp.u(3),'leave');
 if pg_temp.held(c,pg_temp.u(3))<>'owner' or pg_temp.held(c,pg_temp.u(2))<>'' or pg_temp.held(b,pg_temp.u(2))<>'admin' or pg_temp.admins(c)<>4 then raise exception 'Transfer with previous leaving wrong'; end if;
 begin perform pg_temp.transfer(c,pg_temp.u(3),'admin');raise exception 'Transfer to the owner';exception when sqlstate 'PT409' then null;end;
 -- Deployed Worker's call: transfer keeps its old meaning (previous owner leaves), now also single-role.
 if (pg_temp.assign_role(c,pg_temp.u(3),'owner','transfer')->>'changed')::boolean then raise exception 'Legacy self-transfer changed'; end if;
 perform pg_temp.assign_role(c,pg_temp.u(4),'owner','transfer');
 if pg_temp.held(c,pg_temp.u(4))<>'owner' or pg_temp.held(c,pg_temp.u(3))<>'' then raise exception 'Legacy transfer wrong'; end if;
 -- A failure late in the transfer rolls back every revoke, the version and the audit.
 select count(*) into logs from public.platform_audit_events; ver:=pg_temp.ver(c);
 begin perform pg_temp.transfer(c,pg_temp.u(9),'admin');raise exception 'Fixture did not fail';exception when check_violation then null;end;
 if (select count(*) from public.platform_audit_events)<>logs or pg_temp.ver(c)<>ver or pg_temp.held(c,pg_temp.u(4))<>'owner' then raise exception 'Failed transfer did not roll back fully'; end if;

 -- Remove from this club: revokes the active role, audited, other clubs untouched; no role = no-op.
 perform pg_temp.remove(c,u1);
 if pg_temp.held(c,u1)<>'' or pg_temp.held(b,u1)<>'admin' then raise exception 'Remove from club wrong'; end if;
 if not exists(select 1 from public.platform_audit_events where actor_id=auth.uid() and action='club_memberships.update'
   and details#>>'{new,user_id}'=u1::text and details#>>'{new,club_id}'=c::text and details#>>'{new,status}'='revoked') then raise exception 'Removal not audited'; end if;
 if (pg_temp.remove(c,u1)->>'changed')::boolean then raise exception 'Second removal changed'; end if;
 if not exists(select 1 from public.club_memberships where club_id=c and user_id=u1 and role='admin' and status='revoked') then raise exception 'History lost'; end if;

 -- Admin limit: Super Admin only, never below the current count, audited with old and new value.
 if pg_temp.admins(c)<>2 then raise exception 'Fixture admin count changed: %',pg_temp.admins(c); end if;
 begin perform public.platform_set_admin_limit(c,1);raise exception 'Limit below current count';exception when sqlstate 'PT409' then null;end;
 begin perform public.platform_set_admin_limit(c,0);raise exception 'Zero limit';exception when invalid_parameter_value then null;end;
 begin perform public.platform_set_admin_limit(c,1001);raise exception 'Huge limit';exception when invalid_parameter_value then null;end;
 result:=public.platform_set_admin_limit(c,2); if not (result->>'changed')::boolean or (select admin_limit from public.club_clubs where id=c)<>2 then raise exception 'Limit not saved: % %',result,(select admin_limit from public.club_clubs where id=c); end if;
 if not exists(select 1 from public.platform_audit_events where actor_id=auth.uid() and action='club_clubs.admin_limit'
   and details#>>'{old,admin_limit}'='5' and details#>>'{new,admin_limit}'='2' and details#>>'{new,club_id}'=c::text) then raise exception 'Limit change not audited'; end if;
 if (public.platform_set_admin_limit(c,2)->>'changed')::boolean then raise exception 'Unchanged limit reported as change'; end if;
 begin perform pg_temp.assign_role(c,pg_temp.u(7),'admin','grant');raise exception 'New limit not enforced';exception when sqlstate 'PT409' then null;end;
 if (public.platform_role_context(u1)->'clubs'->0->>'admins') is null then raise exception 'Context lacks admin count'; end if;

 -- Same request replay stays successful after version advance and never creates a second audit.
 ver:=pg_temp.ver(c);
 result:=public.platform_assign_role(c,pg_temp.u(5),'admin','revoke',ver,request);
 select count(*) into logs from public.platform_audit_events;
 if public.platform_assign_role(c,pg_temp.u(5),'admin','revoke',ver,request)<>result or (select count(*) from public.platform_audit_events)<>logs then raise exception 'Replay mutated twice'; end if;
 begin perform public.platform_assign_role(b,pg_temp.u(5),'admin','revoke',ver,request);raise exception 'Request reused with new club';exception when sqlstate 'PT409' then null;end;
 begin perform public.platform_remove_from_club(c,pg_temp.u(5),ver,request);raise exception 'Request reused for removal';exception when sqlstate 'PT409' then null;end;
 begin perform public.platform_assign_role(c,u1,'admin','grant',ver,gen_random_uuid());raise exception 'Stale version accepted';exception when sqlstate 'PT409' then null;end;
 -- An existing administrator whose email becomes unverified can still be removed.
 update auth.users set email_confirmed_at=null where id=pg_temp.u(6);
 perform pg_temp.remove(c,pg_temp.u(6));
 if pg_temp.held(c,pg_temp.u(6))<>'' then raise exception 'Unverified admin not removed'; end if;

 -- Without live trusted MFA nothing works, including replays; ordinary owners have no platform powers.
 perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 begin perform public.platform_assign_role(c,pg_temp.u(5),'admin','revoke',ver,request);raise exception 'Replay bypassed MFA';exception when insufficient_privilege then null;end;
 begin perform pg_temp.transfer(c,pg_temp.u(7),'leave');raise exception 'Transfer bypassed MFA';exception when insufficient_privilege then null;end;
 begin perform pg_temp.remove(c,pg_temp.u(7));raise exception 'Removal bypassed MFA';exception when insufficient_privilege then null;end;
 begin perform public.platform_set_admin_limit(c,9);raise exception 'Limit bypassed MFA';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',pg_temp.u(4)::text,true);
 perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
 begin perform pg_temp.remove(c,pg_temp.u(5));raise exception 'Owner removed via platform';exception when insufficient_privilege then null;end;
 begin perform pg_temp.transfer(c,pg_temp.u(5),'leave');raise exception 'Owner transferred via platform';exception when insufficient_privilege then null;end;
 begin perform public.platform_set_admin_limit(c,9);raise exception 'Owner changed limit';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
end $$;

-- Clients reach role changes only through the gated public functions.
do $$ begin
 if has_function_privilege('authenticated','club_private.change_role(uuid,uuid,text,text,text,bigint,uuid)','EXECUTE')
   or has_function_privilege('authenticated','club_private.require_role_manager()','EXECUTE') then raise exception 'Private role function callable'; end if;
 if not has_function_privilege('authenticated','public.platform_transfer_owner(uuid,uuid,text,bigint,uuid)','EXECUTE') then raise exception 'Transfer not callable'; end if;
end $$;
