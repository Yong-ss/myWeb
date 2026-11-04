-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Simulated MFA: a confirmed TOTP factor and a live aal2 session for the Super Admin (see P2 activation).
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000f001','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000c001','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f001');
insert into public.platform_super_admin_factors(factor_id,user_id) values ('00000000-0000-4000-8000-00000000f001','d0ddb226-a10a-471c-be4b-d5e5153bd313');
-- d0dd... is the migration's Super Admin and the bootstrap club's owner.
-- 0a01 owner, 0a02 admin, 0a03 revoked admin, 0a04 outsider, 0a05 unconfirmed admin; all in club X (0a10).
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000a01','leader@club.test',now()),
 ('00000000-0000-4000-8000-000000000a02','manager@club.test',now()),
 ('00000000-0000-4000-8000-000000000a03','revoked@club.test',now()),
 ('00000000-0000-4000-8000-000000000a04','outsider@club.test',now()),
 ('00000000-0000-4000-8000-000000000a05','unconfirmed@club.test',null);
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-000000000a10','Authz X'),('00000000-0000-4000-8000-000000000a11','Authz Y');
insert into public.club_memberships(club_id,user_id,role,status) values
 ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a01','owner','active'),
 ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a02','admin','active'),
 ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a03','admin','revoked'),
 ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a05','admin','active');

-- The registry must reproduce the legacy hard-coded owner/admin rules exactly, or P2's switch silently changes access.
set local role authenticated;
do $$
declare
  actions text[] := array['absences.resolve','aliases.manage','audit.read','club.admins.manage','club.admins.permissions','club.alliance.request','club.rename','events.edit','events.import','events.read','imports.create','imports.delete','members.read'];
  person record; perm text; expected text[];
begin
  for person in select * from (values
    ('00000000-0000-4000-8000-000000000a01'::uuid,'owner'),('00000000-0000-4000-8000-000000000a02','admin'),
    ('00000000-0000-4000-8000-000000000a03','revoked'),('00000000-0000-4000-8000-000000000a04','none'),('00000000-0000-4000-8000-000000000a05','unconfirmed')) v(id,kind) loop
    perform set_config('request.jwt.claim.sub',person.id::text,true);
    expected := '{}';
    -- Legacy: an active, confirmed owner/admin does everything; only the owner renames. Nobody sees emails by default.
    -- Stage C adds the owner-only management powers (club.admins.*), stage F the alliance request; never admins.
    foreach perm in array actions loop
      if person.kind='owner' or (person.kind='admin' and perm not in ('club.rename','club.admins.manage','club.admins.permissions','club.alliance.request')) then expected := expected || perm; end if;
    end loop;
    if public.club_my_permissions('00000000-0000-4000-8000-000000000a10') is distinct from expected then
      raise exception 'Permission drift for %: % <> %', person.kind, public.club_my_permissions('00000000-0000-4000-8000-000000000a10'), expected;
    end if;
    if public.club_my_permissions('00000000-0000-4000-8000-000000000a11') <> '{}' then raise exception 'Cross-club permission for %', person.kind; end if;
  end loop;
end $$;

-- Super Admin: every permission on every existing club, but only with MFA (aal2).
do $$
declare all_perms text[] := array['absences.resolve','aliases.manage','audit.actor_email.read','audit.read','club.admins.manage','club.admins.permissions','club.alliance.request','club.rename','events.edit','events.import','events.read','imports.create','imports.delete','members.read'];
begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  if public.club_my_permissions('00000000-0000-4000-8000-000000000a11') <> '{}' then raise exception 'Super Admin powers without MFA'; end if;
  if public.club_my_permissions('ce0c7103-1cdf-4b08-8619-f71d4915f598') <> array_remove(all_perms,'audit.actor_email.read') then raise exception 'Own owner membership lost without MFA'; end if;
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  if public.club_my_permissions('00000000-0000-4000-8000-000000000a11') <> all_perms then raise exception 'Super Admin lacks access to an unrelated club'; end if;
  if public.club_my_permissions('00000000-0000-4000-8000-0000000000ff') <> '{}' then raise exception 'Permissions for a nonexistent club'; end if;
  if not array['ce0c7103-1cdf-4b08-8619-f71d4915f598','00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a11']::uuid[] <@ array(select club_private.readable_clubs('members.read')) then raise exception 'Super Admin readable_clubs incomplete'; end if;
  -- Since P2 business RLS follows readable_clubs: an MFA-verified Super Admin reads every club.
  if (select count(*) from public.club_clubs) <> (select count(*) from club_private.readable_clubs('members.read')) then raise exception 'Business RLS does not follow readable_clubs'; end if;
  -- MFA alone grants nothing.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a04',true);
  if public.club_my_permissions('00000000-0000-4000-8000-000000000a10') <> '{}' then raise exception 'aal2 alone grants access'; end if;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a01',true);
  if array(select club_private.readable_clubs('members.read')) <> array['00000000-0000-4000-8000-000000000a10'::uuid] then raise exception 'readable_clubs leaks or misses clubs'; end if;
  if array(select club_private.readable_clubs('members.reed')) <> '{}' then raise exception 'Unregistered permission readable'; end if;
end $$;

-- Clients cannot call internal checks, read the registry or Super Admin list, or edit roles.
do $$ begin
  if has_function_privilege('authenticated','club_private.can(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','club_private.require(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','club_private.super_admin_active()','EXECUTE')
    or has_function_privilege('anon','public.club_my_permissions(uuid)','EXECUTE')
    or has_function_privilege('anon','public.club_activity(uuid,timestamptz,uuid)','EXECUTE') then raise exception 'Internal authorization function exposed'; end if;
  begin perform 1 from public.platform_super_admins; raise exception 'Super Admin list readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.auth_permissions; raise exception 'Registry readable'; exception when insufficient_privilege then null; end;
  begin insert into public.platform_super_admins(user_id) values ('00000000-0000-4000-8000-000000000a04'); raise exception 'Self-promotion to Super Admin'; exception when insufficient_privilege then null; end;
  begin insert into public.auth_role_permissions values ('admin','club.rename'); raise exception 'Client edited a role'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.club_audit_events; raise exception 'Raw audit table readable'; exception when insufficient_privilege then null; end;
  begin perform submitted_by from public.club_imports; raise exception 'Import submitter readable'; exception when insufficient_privilege then null; end;
  begin perform confirmed_by from public.club_player_aliases; raise exception 'Alias confirmer readable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Any client-readable column pointing at auth.users would identify people (including the Super Admin) across clubs.
-- Only the caller's own membership row (self-only RLS) may expose a user ID.
do $$ declare r record; begin
  for r in select cl.relname, a.attname from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.contype='f' and c.confrelid='auth.users'::regclass and cl.relnamespace='public'::regnamespace loop
    if (r.relname,r.attname)<>('club_memberships','user_id')
      and (has_column_privilege('authenticated',format('public.%I',r.relname),r.attname,'SELECT') or has_column_privilege('anon',format('public.%I',r.relname),r.attname,'SELECT')) then
      raise exception 'User ID column readable by clients: %.%', r.relname, r.attname;
    end if;
  end loop;
end $$;
set local role authenticated;
reset role;

-- Unregistered keys are denied to everyone, including an MFA-verified Super Admin; require() fails closed.
do $$ begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  if club_private.can('00000000-0000-4000-8000-000000000a10','members.reed') then raise exception 'Typo permission granted'; end if;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a04',true);
  begin perform club_private.require('00000000-0000-4000-8000-000000000a10','imports.create'); raise exception 'require() allowed an outsider';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a02',true);
  perform club_private.require('00000000-0000-4000-8000-000000000a10','imports.create');
end $$;

-- Invariants that are not configurable.
do $$ begin
  insert into public.auth_permissions(key,kind,allowed_scopes,read_only,description) values ('test.platform_only','action','{platform}',true,'fixture');
  begin insert into public.auth_role_permissions values ('owner','test.platform_only'); raise exception 'Out-of-scope permission granted'; exception when check_violation then null; end;
  begin insert into public.auth_permissions(key,kind,allowed_scopes,read_only,description) values ('test.alliance_write','action','{alliance,club}',false,'fixture');
    raise exception 'Alliance write permission registered'; exception when check_violation then null; end;
  begin update public.auth_roles set scope_kind='platform' where key='admin'; raise exception 'Role scope changed in place'; exception when check_violation then null; end;
  begin update public.auth_permissions set allowed_scopes='{club,alliance}' where key='imports.create'; raise exception 'Permission scope widened'; exception when check_violation then null; end;
  -- A club's own role is assignable only in that club; platform roles never become club memberships.
  insert into public.auth_roles(key,scope_kind,club_id,name) values ('x_reader','club','00000000-0000-4000-8000-000000000a10','X 只读');
  insert into public.auth_roles(key,scope_kind,name) values ('test_platform','platform','fixture');
  begin insert into public.auth_roles(key,scope_kind,club_id,is_system,name) values ('bad_system','club','00000000-0000-4000-8000-000000000a10',true,'x');
    raise exception 'Club-owned system role'; exception when check_violation then null; end;
end $$;

-- Audit storage: never the Super Admin's email (forged markers are ignored), always the real actor_id; rows are immutable.
insert into public.club_audit_events(club_id,actor_id,action,details) values
 ('00000000-0000-4000-8000-000000000a10','d0ddb226-a10a-471c-be4b-d5e5153bd313','authz_super','{"actor_email":"forged@x.test","actor_kind":"member"}'),
 ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a01','authz_owner','{"actor_kind":"super_admin"}');
-- A legacy row written before this migration, still holding the Super Admin's email.
alter table public.club_audit_events disable trigger club_audit_actor;
insert into public.club_audit_events(club_id,actor_id,action,details,created_at) values
 ('00000000-0000-4000-8000-000000000a10','d0ddb226-a10a-471c-be4b-d5e5153bd313','authz_legacy','{"actor_email":"owner@club.test","actor_role":"owner"}',now()-interval '1 day');
alter table public.club_audit_events enable trigger club_audit_actor;
do $$ begin
  if exists(select 1 from public.club_audit_events where action='authz_super' and (details ? 'actor_email' or details->>'actor_kind'<>'super_admin' or actor_id<>'d0ddb226-a10a-471c-be4b-d5e5153bd313')) then raise exception 'Super Admin audit stored an email or lost its actor'; end if;
  if not exists(select 1 from public.club_audit_events where action='authz_owner' and details->>'actor_email'='leader@club.test' and details->>'actor_role'='owner' and not details ? 'actor_kind') then raise exception 'Ordinary audit lost email/role or kept a forged marker'; end if;
  begin update public.club_audit_events set action='x' where action='authz_owner'; raise exception 'Audit updated'; exception when insufficient_privilege then null; end;
  begin delete from public.club_audit_events where action='authz_owner'; raise exception 'Audit deleted'; exception when insufficient_privilege then null; end;
  begin truncate public.club_audit_events; raise exception 'Audit truncated'; exception when insufficient_privilege then null; end;
end $$;

-- Audit reads: nobody but an MFA-verified Super Admin ever sees the Super Admin's email or user ID.
set local role authenticated;
do $$
declare x uuid := '00000000-0000-4000-8000-000000000a10'; log jsonb; e jsonb;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a02',true);
  log := public.club_activity(x);
  if jsonb_array_length(log->'events')<>3 then raise exception 'Audit rows missing'; end if;
  if log::text like '%@%' or log::text like '%d0ddb226%' then raise exception 'Email or Super Admin ID visible by default: %', log; end if;
  for e in select value from jsonb_array_elements(log->'events') where value->>'action' in ('authz_super','authz_legacy') loop
    if e->>'actor_label'<>'超级管理员' or e->>'actor_kind'<>'super_admin' or e->'actor_id'<>'null'::jsonb then raise exception 'Super Admin row not masked: %', e; end if;
  end loop;
  if (select value->>'actor_role' from jsonb_array_elements(log->'events') where value->>'action'='authz_owner')<>'owner' then raise exception 'Role hidden'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a03',true);
  if public.club_activity(x)->'events'<>'[]' then raise exception 'Revoked user reads audit'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a05',true);
  if public.club_activity(x)->'events'<>'[]' then raise exception 'Unconfirmed user reads audit'; end if;
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  if public.club_activity(x)->'events'<>'[]' then raise exception 'Super Admin reads another club without MFA'; end if;
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  e := (select value from jsonb_array_elements(public.club_activity(x)->'events') where value->>'action'='authz_super');
  if e->>'actor_label'<>'owner@club.test' or e->>'actor_id'<>'d0ddb226-a10a-471c-be4b-d5e5153bd313' then raise exception 'Super Admin cannot trace own audit: %', e; end if;
  -- A null club reads nothing, even for the Super Admin. (Cursor arguments only page within an already authorized club.)
  if public.club_activity(null)->'events'<>'[]' then raise exception 'Null club read audit rows'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;

-- Granting the email field permission reveals ordinary emails, never the Super Admin's. The public name is display-only.
insert into public.auth_role_permissions values ('admin','audit.actor_email.read'),('x_reader','members.read'),('x_reader','audit.read');
-- Since P2 the legacy owner/admin check is gone; the scope trigger alone must stop cross-club and non-club roles.
do $$ begin
  if exists(select 1 from pg_constraint where conname='club_memberships_role_check') then raise exception 'Legacy role check still present'; end if;
end $$;
do $$ begin
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000a11','00000000-0000-4000-8000-000000000a04','x_reader');
    raise exception 'Club role assigned in another club'; exception when check_violation then null; end;
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000a11','00000000-0000-4000-8000-000000000a04','test_platform');
    raise exception 'Platform role used as a club membership'; exception when check_violation then null; end;
  begin insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000a11','00000000-0000-4000-8000-000000000a04','no_such_role');
    raise exception 'Unknown role accepted'; exception when check_violation or foreign_key_violation then null; end;
end $$;
insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000a10','00000000-0000-4000-8000-000000000a04','x_reader');
-- Defense in depth: even a row that bypassed the trigger cannot use club X's role inside club Y.
alter table public.club_memberships disable trigger club_membership_role_scope;
insert into public.club_memberships(club_id,user_id,role) values ('00000000-0000-4000-8000-000000000a11','00000000-0000-4000-8000-000000000a04','x_reader');
alter table public.club_memberships enable trigger club_membership_role_scope;
update public.platform_super_admins set public_name='平台守护者';
set local role authenticated;
do $$ declare x uuid := '00000000-0000-4000-8000-000000000a10'; log jsonb; begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a02',true);
  log := public.club_activity(x);
  if (select value->>'actor_label' from jsonb_array_elements(log->'events') where value->>'action'='authz_owner')<>'leader@club.test' then raise exception 'Member email hidden from a permitted viewer'; end if;
  if log::text like '%owner@club.test%' or log::text like '%forged@x.test%' or log::text like '%d0ddb226%' then raise exception 'Super Admin identity leaked to an email-permitted viewer: %', log; end if;
  if not log::text like '%平台守护者%' then raise exception 'Public name not used'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a04',true);
  if public.club_my_permissions(x)<>array['audit.read','members.read'] then raise exception 'Custom club role permissions wrong'; end if;
  if public.club_my_permissions('00000000-0000-4000-8000-000000000a11')<>'{}' then raise exception 'Club-owned role worked in another club'; end if;
  -- Probing reveals nothing: a real club and a nonexistent one look identical to a non-member.
  if public.club_my_permissions('ce0c7103-1cdf-4b08-8619-f71d4915f598') is distinct from public.club_my_permissions('00000000-0000-4000-8000-0000000000ff') then raise exception 'Club existence observable'; end if;
  if public.club_activity(x)::text like '%@%' then raise exception 'Custom role without field permission sees emails'; end if;
end $$;
reset role;
select 'club_authz: legacy permission equivalence, MFA-gated Super Admin, registry invariants, audit privacy and immutability passed' as result;
