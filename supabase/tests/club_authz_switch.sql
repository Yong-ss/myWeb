-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Simulated MFA: a confirmed TOTP factor and a live aal2 session for the Super Admin (see P2 activation).
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000f001','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000c001','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f001');
insert into public.platform_super_admin_factors(factor_id,user_id) values ('00000000-0000-4000-8000-00000000f001','d0ddb226-a10a-471c-be4b-d5e5153bd313');
-- P2: writes, business RLS and the Worker's access read all go through can(). d0dd... is the Super Admin.
-- 0b01 owner of X, 0b02 admin of X, 0b03 outsider. X=0b10, Y=0b11 (no members except the Y owner 0b04).
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000b01','x-owner@club.test',now()),
 ('00000000-0000-4000-8000-000000000b02','x-admin@club.test',now()),
 ('00000000-0000-4000-8000-000000000b03','outsider2@club.test',now()),
 ('00000000-0000-4000-8000-000000000b04','y-owner@club.test',now());
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-000000000b10','Switch X'),('00000000-0000-4000-8000-000000000b11','Switch Y');
insert into public.club_memberships(club_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b01','owner'),
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','admin'),
 ('00000000-0000-4000-8000-000000000b11','00000000-0000-4000-8000-000000000b04','owner');
insert into public.club_players(id,club_id,display_name) values
 ('00000000-0000-4000-8000-000000000b20','00000000-0000-4000-8000-000000000b10','X player'),
 ('00000000-0000-4000-8000-000000000b21','00000000-0000-4000-8000-000000000b11','Y player');
-- A custom club role for X: everything the admin role has, plus rename.
insert into public.auth_roles(key,scope_kind,club_id,name) values ('x_namer','club','00000000-0000-4000-8000-000000000b10','X 改名');
insert into public.auth_role_permissions select 'x_namer',permission_key from public.auth_role_permissions where role_key='admin';
insert into public.auth_role_permissions values ('x_namer','club.rename');

-- Stage A single role (supersedes D-036 union): one active role per user per club; still at most one active owner.
do $$ begin
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','x_namer');
    raise exception 'Second active role accepted'; exception when unique_violation then null; end;
  -- Changing role = revoke the old one, then grant the new one; the old row stays as history.
  update public.club_memberships set status='revoked' where club_id='00000000-0000-4000-8000-000000000b10' and user_id='00000000-0000-4000-8000-000000000b02' and role='admin';
  insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','x_namer');
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','owner');
    raise exception 'Second active owner accepted'; exception when unique_violation then null; end;
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000b11','00000000-0000-4000-8000-000000000b02','x_namer');
    raise exception 'Club-owned role used in another club'; exception when check_violation then null; end;
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','x_namer');
    raise exception 'Duplicate role row accepted'; exception when unique_violation then null; end;
end $$;

set local role authenticated;
do $$
declare x uuid := '00000000-0000-4000-8000-000000000b10'; y uuid := '00000000-0000-4000-8000-000000000b11'; a jsonb;
begin
  -- x_namer: everything admin has plus rename, and the rename RPC now succeeds for this user.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b02',true);
  a := public.club_my_access(x);
  if a->'permissions' <> '["absences.resolve","aliases.manage","audit.read","club.rename","events.edit","events.import","events.read","imports.create","imports.delete","members.read"]'::jsonb
    or a->'roles' <> '["x_namer"]'::jsonb or (a->>'super_admin')::boolean or (a->>'super_admin_active')::boolean then raise exception 'Multi-role access wrong: %', a; end if;
  if public.club_rename(x,'Switch X2','Switch X')->>'name' <> 'Switch X2' then raise exception 'Merged rename permission not usable'; end if;
  -- Business RLS: own club only.
  if (select count(*) from public.club_players) <> 1 or (select count(*) from public.club_clubs) <> 1 then raise exception 'Admin RLS scope wrong'; end if;
  if public.club_my_access(y)->'permissions' <> '[]' then raise exception 'Cross-club access'; end if;
  begin perform public.club_rename(y,'越权','Switch Y'); raise exception 'Cross-club rename'; exception when insufficient_privilege then null; end;
  -- Clients still cannot assign roles to themselves.
  begin insert into public.club_memberships(club_id,user_id,role) values (x,'00000000-0000-4000-8000-000000000b02','owner'); raise exception 'Self-assignment'; exception when insufficient_privilege then null; end;
  begin update public.club_memberships set role='owner' where user_id='00000000-0000-4000-8000-000000000b02'; raise exception 'Self-promotion'; exception when insufficient_privilege then null; end;
  -- An outsider reads and writes nothing.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b03',true);
  if (select count(*) from public.club_players) <> 0 or (select count(*) from public.club_snapshots) <> 0 or public.club_my_access(x)->'permissions' <> '[]' then raise exception 'Outsider reads data'; end if;
  begin perform public.club_rename(x,'越权','Switch X2'); raise exception 'Outsider rename'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Switching back to admin removes rename immediately; revoking all removes access.
update public.club_memberships set status='revoked' where user_id='00000000-0000-4000-8000-000000000b02' and role='x_namer';
update public.club_memberships set status='active' where user_id='00000000-0000-4000-8000-000000000b02' and role='admin';
set local role authenticated;
do $$ declare x uuid := '00000000-0000-4000-8000-000000000b10'; begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b02',true);
  if public.club_my_access(x)->'roles' <> '["admin"]' or public.club_my_access(x)->'permissions' ? 'club.rename' then raise exception 'Revoked role still grants'; end if;
  begin perform public.club_rename(x,'Switch X3','Switch X2'); raise exception 'Revoked rename still works'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.club_players) <> 1 then raise exception 'Remaining role lost reads'; end if;
end $$;
reset role;
update public.club_memberships set status='revoked' where user_id='00000000-0000-4000-8000-000000000b02';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b02',true);
  if (select count(*) from public.club_players) <> 0 or public.club_my_access('00000000-0000-4000-8000-000000000b10')->'permissions' <> '[]' then raise exception 'Fully revoked user still reads'; end if;
end $$;

-- Super Admin: without MFA only its own owner membership applies; with aal2 it reads and writes every club.
do $$ declare y uuid := '00000000-0000-4000-8000-000000000b11'; a jsonb; begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  a := public.club_my_access(y);
  if a->'permissions' <> '[]' or not (a->>'super_admin')::boolean or (a->>'super_admin_active')::boolean then raise exception 'Super Admin aal1 state wrong: %', a; end if;
  if exists(select 1 from public.club_players where club_id=y) then raise exception 'Super Admin reads another club without MFA'; end if;
  begin perform public.club_rename(y,'越权','Switch Y'); raise exception 'Super Admin writes without MFA'; exception when insufficient_privilege then null; end;
  if public.club_my_access('ce0c7103-1cdf-4b08-8619-f71d4915f598')->'roles' <> '["owner"]' then raise exception 'Super Admin lost own owner role without MFA'; end if;
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  a := public.club_my_access(y);
  if not (a->>'super_admin_active')::boolean or jsonb_array_length(a->'permissions') <> 14 or a->'roles' <> '[]' then raise exception 'Super Admin aal2 state wrong: %', a; end if;
  if (select count(*) from public.club_players where club_id in ('00000000-0000-4000-8000-000000000b10',y)) <> 2 then raise exception 'Super Admin cannot read all clubs'; end if;
  if public.club_rename(y,'Switch Y2','Switch Y')->>'name' <> 'Switch Y2' then raise exception 'Super Admin cannot write'; end if;
  -- Unconfirmed or nonexistent identities never become Super Admin.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b03',true);
  if (public.club_my_access(y)->>'super_admin')::boolean then raise exception 'Outsider reported as Super Admin'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;

-- The Super Admin's cross-club write is audited with its real actor_id, no email, and no fabricated club role.
do $$ begin
  if not exists(select 1 from public.club_audit_events where club_id='00000000-0000-4000-8000-000000000b11' and action='club_renamed'
    and actor_id='d0ddb226-a10a-471c-be4b-d5e5153bd313' and details->>'actor_kind'='super_admin' and not details ? 'actor_email' and details->'actor_role'='null'::jsonb) then
    raise exception 'Super Admin cross-club audit wrong';
  end if;
  -- The audit records the actor's active role at the time, not an older revoked row (admin was revoked then).
  if (select details->>'actor_role' from public.club_audit_events where club_id='00000000-0000-4000-8000-000000000b10' and action='club_renamed' order by created_at limit 1) <> 'x_namer' then raise exception 'Audit role is not the active role'; end if;
  -- No write function keeps a hard-coded owner/admin check.
  if exists(select 1 from pg_proc where pronamespace in ('public'::regnamespace,'club_private'::regnamespace)
    and proname in ('commit_import','manage_alias','delete_import_date','resolve_absence','club_rename') and (prosrc ~ 'role in \(' or prosrc ~ 'role=''owner''')) then
    raise exception 'Hard-coded role check remains';
  end if;
  -- Every permissive policy (any name) grants only through readable_clubs; permissive policies OR together, so one
  -- stray membership-based policy would bypass the registry. The caller's own membership row is the sole exception.
  if exists(select 1 from pg_policies where schemaname='public' and permissive='PERMISSIVE'
    and (tablename, policyname) <> ('club_memberships','membership_read_self') and coalesce(qual,'') !~ 'readable_clubs') then
    raise exception 'Business policy not switched: %', (select string_agg(tablename||'.'||policyname, ',') from pg_policies where schemaname='public' and permissive='PERMISSIVE'
      and (tablename, policyname) <> ('club_memberships','membership_read_self') and coalesce(qual,'') !~ 'readable_clubs');
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and permissive='PERMISSIVE' and cmd <> 'SELECT') then raise exception 'Client write policy exists'; end if;
end $$;
-- First activation. A password thief can bind a TOTP and reach aal2, but powers need a factor the owner confirmed
-- out of band (SQL Editor). Also: aal1/expired/foreign sessions, malformed session IDs and deleted factors grant nothing.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000f101','d0ddb226-a10a-471c-be4b-d5e5153bd313','attacker phone','totp','verified'),
 ('00000000-0000-4000-8000-00000000f102','d0ddb226-a10a-471c-be4b-d5e5153bd313','half done','totp','unverified'),
 ('00000000-0000-4000-8000-00000000f103','00000000-0000-4000-8000-000000000b01','owner of X','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id,not_after) values
 ('00000000-0000-4000-8000-00000000c101','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f101',null),
 ('00000000-0000-4000-8000-00000000c102','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal1',null,null),
 ('00000000-0000-4000-8000-00000000c103','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f001',now()-interval '1 minute'),
 ('00000000-0000-4000-8000-00000000c104','00000000-0000-4000-8000-000000000b01','aal2','00000000-0000-4000-8000-00000000f001',null);
set local role authenticated;
do $$
declare y uuid := '00000000-0000-4000-8000-000000000b11'; sid text; a jsonb;
begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  foreach sid in array array['00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000c102','00000000-0000-4000-8000-00000000c103','00000000-0000-4000-8000-00000000c104','not-a-uuid','00000000-0000-4000-8000-0000000000ff'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('aal','aal2','session_id',sid)::text,true);
    a := public.club_my_access(y);
    if (a->>'super_admin_active')::boolean or a->'permissions' <> '[]' or exists(select 1 from public.club_players where club_id=y) then raise exception 'Super Admin powers from session %: %', sid, a; end if;
    if not (a->>'session_aal2')::boolean then raise exception 'aal2 session not reported for %', sid; end if;
  end loop;
  -- The confirmed factor's session works; the owner's own club rights never depended on any of this.
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  if not (public.club_my_access(y)->>'super_admin_active')::boolean then raise exception 'Confirmed factor session inactive'; end if;
  if public.club_my_trusted_factors() <> array['00000000-0000-4000-8000-00000000f001'::uuid] then raise exception 'Trusted factor list wrong'; end if;
  -- Clients can neither confirm a factor nor see or edit the confirmation table.
  if has_function_privilege('authenticated','club_private.trust_super_admin_factor(uuid)','EXECUTE') then raise exception 'Confirmation callable by clients'; end if;
  begin perform club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f101'); raise exception 'Client confirmed a factor'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_super_admin_factors; raise exception 'Confirmation table readable'; exception when insufficient_privilege then null; end;
  begin insert into public.platform_super_admin_factors(factor_id,user_id) values ('00000000-0000-4000-8000-00000000f101','d0ddb226-a10a-471c-be4b-d5e5153bd313'); raise exception 'Client inserted confirmation'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b01',true);
  if public.club_my_trusted_factors() <> '{}' then raise exception 'Other users see trusted factors'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;
-- The confirmation step accepts only the Super Admin's own verified TOTP factors.
do $$ begin
  begin perform club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f102'); raise exception 'Unverified factor confirmed'; exception when sqlstate '22023' then null; end;
  begin perform club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f103'); raise exception 'Non-Super-Admin factor confirmed'; exception when sqlstate '22023' then null; end;
  if club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f101') not like '%attacker phone%' then raise exception 'Confirmation does not name the factor'; end if;
  -- Neither the publishable key (anon/authenticated) nor the secret key (service_role, bypasses RLS) can confirm or edit.
  if has_function_privilege('anon','club_private.trust_super_admin_factor(uuid)','EXECUTE') or has_function_privilege('service_role','club_private.trust_super_admin_factor(uuid)','EXECUTE')
    or has_table_privilege('service_role','public.platform_super_admin_factors','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('anon','public.platform_super_admin_factors','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Confirmation reachable by an API key'; end if;
  -- The confirmation is traceable: which device, when it was bound, when and by which database login it was confirmed.
  if not exists(select 1 from public.platform_super_admin_factors where factor_id='00000000-0000-4000-8000-00000000f101' and user_id='d0ddb226-a10a-471c-be4b-d5e5153bd313'
    and factor_name='attacker phone' and factor_created_at is not null and trusted_at is not null and trusted_by=session_user) then raise exception 'Confirmation not recorded'; end if;
  -- Repeating it keeps the original record, and the record can be neither changed nor removed.
  perform club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f101');
  if (select count(*) from public.platform_super_admin_factors where factor_id='00000000-0000-4000-8000-00000000f101') <> 1 then raise exception 'Repeat confirmation duplicated the record'; end if;
  begin update public.platform_super_admin_factors set trusted_at=now(); raise exception 'Confirmation record updated'; exception when insufficient_privilege then null; end;
  begin delete from public.platform_super_admin_factors; raise exception 'Confirmation record deleted'; exception when insufficient_privilege then null; end;
  begin truncate public.platform_super_admin_factors; raise exception 'Confirmation records truncated'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c101"}',true);
  if not (public.club_my_access('00000000-0000-4000-8000-000000000b11')->>'super_admin_active')::boolean then raise exception 'Newly confirmed factor inactive'; end if;
end $$;
reset role;
-- Removing the factor (or ending the session) ends powers at once, even with an unexpired aal2 JWT.
delete from auth.mfa_factors where id='00000000-0000-4000-8000-00000000f101';
delete from auth.sessions where id='00000000-0000-4000-8000-00000000c001';
set local role authenticated;
do $$ declare sid text; begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  foreach sid in array array['00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000c001'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('aal','aal2','session_id',sid)::text,true);
    if (public.club_my_access('00000000-0000-4000-8000-000000000b11')->>'super_admin_active')::boolean then raise exception 'Powers survive removal for %', sid; end if;
  end loop;
  -- The owner membership still works throughout.
  if public.club_my_access('ce0c7103-1cdf-4b08-8619-f71d4915f598')->'roles' <> '["owner"]' then raise exception 'Owner rights lost'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;
select 'club_authz_switch: single active role, owner uniqueness, revocation, tenant RLS, MFA-gated Super Admin reads/writes and audit, first-activation confirmation passed' as result;
