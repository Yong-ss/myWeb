-- Disposable PostgreSQL only. Every successful assignment and audit rolls back after this suite.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000f041','d0ddb226-a10a-471c-be4b-d5e5153bd313','roles fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000c041','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f041');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f041');
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c041"}',true);
insert into auth.users(id,email,email_confirmed_at) select md5('p4-user-'||n)::uuid,'p4-'||n||'@fixture.invalid',case when n=8 then null else now() end from generate_series(1,8)n;
insert into public.club_clubs(id,name) values(md5('p4-club')::uuid,'P4 fixture'),(md5('p4-foreign')::uuid,'P4 foreign');

create function pg_temp.assign_role(c uuid,u uuid,r text,a text) returns jsonb language sql as $$
 select public.platform_assign_role(c,u,r,a,(select role_version from public.club_clubs where id=c),gen_random_uuid());
$$;
-- Force failure after transfer has revoked the previous owner: both membership and audit must roll back.
create function pg_temp.reject_transfer_fixture() returns trigger language plpgsql as $$
begin
 if new.user_id=md5('p4-user-7')::uuid and new.role='owner' then raise check_violation using message='fixture transfer failure'; end if;
 return new;
end $$;
create trigger p4_transfer_fixture before insert or update on public.club_memberships for each row execute function pg_temp.reject_transfer_fixture();
do $$
declare c uuid:=md5('p4-club')::uuid; b uuid:=md5('p4-foreign')::uuid; u uuid:=md5('p4-user-1')::uuid;
 request uuid:=gen_random_uuid(); ver bigint; result jsonb; logs bigint; i int;
begin
 perform pg_temp.assign_role(c,u,'owner','grant');
 perform pg_temp.assign_role(c,u,'admin','grant');
 if (select count(*) from public.club_memberships where club_id=c and user_id=u and status='active')<>2 then raise exception 'Role union lost'; end if;
 perform pg_temp.assign_role(c,u,'admin','revoke');
 if not exists(select 1 from public.club_memberships where club_id=c and user_id=u and role='owner' and status='active') then raise exception 'Other role revoked'; end if;
 perform pg_temp.assign_role(c,u,'admin','grant');
 for i in 2..5 loop perform pg_temp.assign_role(c,md5('p4-user-'||i)::uuid,'admin','grant'); end loop;
 select count(*) into logs from public.platform_audit_events;
 begin perform pg_temp.assign_role(c,md5('p4-user-6')::uuid,'admin','grant');raise exception 'Cap bypassed';exception when sqlstate 'PT409' then null;end;
 if (select count(*) from public.platform_audit_events)<>logs then raise exception 'Failed grant logged'; end if;
 begin perform pg_temp.assign_role(c,u,'owner','revoke');raise exception 'Last owner revoked';exception when sqlstate 'PT409' then null;end;
 begin perform pg_temp.assign_role(c,md5('p4-user-6')::uuid,'owner','grant');raise exception 'Second owner allowed';exception when sqlstate 'PT409' then null;end;
 begin perform pg_temp.assign_role(c,md5('p4-user-8')::uuid,'admin','grant');raise exception 'Unverified grant allowed';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.assign_role(c,u,'super_admin','grant');raise exception 'Super Admin role accepted';exception when invalid_parameter_value then null;end;
 perform pg_temp.assign_role(c,md5('p4-user-6')::uuid,'owner','transfer');
 if (select count(*) from public.club_memberships where club_id=c and role='owner' and status='active')<>1
 or not exists(select 1 from public.club_memberships where club_id=c and user_id=u and role='admin' and status='active') then raise exception 'Atomic transfer lost roles'; end if;
 select count(*) into logs from public.platform_audit_events;
 select role_version into ver from public.club_clubs where id=c;
 begin perform pg_temp.assign_role(c,md5('p4-user-7')::uuid,'owner','transfer');raise exception 'Fixture did not fail';exception when check_violation then null;end;
 if (select count(*) from public.platform_audit_events)<>logs or (select role_version from public.club_clubs where id=c)<>ver
   or not exists(select 1 from public.club_memberships where club_id=c and user_id=md5('p4-user-6')::uuid and role='owner' and status='active') then raise exception 'Failed transfer did not roll back fully'; end if;
 if exists(select 1 from public.club_memberships where club_id=b) then raise exception 'Cross-club mutation'; end if;
 -- Same request replay stays successful after version advance and never creates a second audit.
 select role_version into ver from public.club_clubs where id=c;
 result:=public.platform_assign_role(c,u,'admin','revoke',ver,request);
 select count(*) into logs from public.platform_audit_events;
 if public.platform_assign_role(c,u,'admin','revoke',ver,request)<>result or (select count(*) from public.platform_audit_events)<>logs then raise exception 'Replay mutated twice'; end if;
 begin perform public.platform_assign_role(b,u,'admin','revoke',ver,request);raise exception 'Request reused with new club';exception when sqlstate 'PT409' then null;end;
 begin perform public.platform_assign_role(c,u,'admin','grant',ver,gen_random_uuid());raise exception 'Stale version accepted';exception when sqlstate 'PT409' then null;end;
 -- An existing administrator whose email becomes unverified can still have access revoked.
 update auth.users set email_confirmed_at=null where id=md5('p4-user-2')::uuid;
 perform pg_temp.assign_role(c,md5('p4-user-2')::uuid,'admin','revoke');
 if not exists(select 1 from public.platform_audit_events where actor_id=auth.uid() and details#>>'{new,user_id}'=u::text and details#>>'{new,status}'='revoked') then raise exception 'Missing target/actor audit'; end if;
 -- Revoked/expired/unconfirmed-device powers cannot replay a previously successful request.
 perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 begin perform public.platform_assign_role(c,u,'admin','revoke',ver,request);raise exception 'Replay bypassed MFA';exception when insufficient_privilege then null;end;
end $$;
