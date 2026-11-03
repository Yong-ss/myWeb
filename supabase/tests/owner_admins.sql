-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Permissions V1 stage C: an owner manages the admins of their own club, and nothing more. Every path goes through
-- change_role / permission_layer (stages A and B); these cases prove the owner cannot step outside their club, their
-- target set (admins only, never themselves) or the Super Admin's caps and forced settings, and that every change is
-- audited and immediately effective.
-- Club X (0d10, admin limit 3): owner o1 0d01, admins a1 0d02, a2 0d03, custom role v1 0d09. Club Y (0d11): owner o2
-- 0d05, admin y1 0d06. c1 0d04 has no role; n1 0d07 is an outsider; u1 0d08 is unconfirmed.
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000d01','o1@team.test',now()),
 ('00000000-0000-4000-8000-000000000d02','a1@team.test',now()),
 ('00000000-0000-4000-8000-000000000d03','a2@team.test',now()),
 ('00000000-0000-4000-8000-000000000d04','c1@team.test',now()),
 ('00000000-0000-4000-8000-000000000d05','o2@team.test',now()),
 ('00000000-0000-4000-8000-000000000d06','y1@team.test',now()),
 ('00000000-0000-4000-8000-000000000d07','n1@team.test',now()),
 ('00000000-0000-4000-8000-000000000d08','u1@team.test',null),
 ('00000000-0000-4000-8000-000000000d09','v1@team.test',now());
insert into public.club_clubs(id,name,admin_limit) values ('00000000-0000-4000-8000-000000000d10','Team X',3),('00000000-0000-4000-8000-000000000d11','Team Y',5);
insert into public.auth_roles(key,scope_kind,club_id,name) values ('t_viewer','club','00000000-0000-4000-8000-000000000d10','X 查看');
insert into public.auth_role_permissions values ('t_viewer','members.read');
insert into public.club_memberships(club_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d01','owner'),
 ('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d02','admin'),
 ('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d03','admin'),
 ('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d09','t_viewer'),
 ('00000000-0000-4000-8000-000000000d11','00000000-0000-4000-8000-000000000d05','owner'),
 ('00000000-0000-4000-8000-000000000d11','00000000-0000-4000-8000-000000000d06','admin');
insert into public.club_players(id,club_id,display_name) values ('00000000-0000-4000-8000-000000000d20','00000000-0000-4000-8000-000000000d10','X player');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000df01','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000dc01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000df01');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000df01');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claims', '{}', true);
$$;
create function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'd0ddb226-a10a-471c-be4b-d5e5153bd313', true), set_config('request.jwt.claims', '{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000dc01"}', true);
$$;
create function pg_temp.can_as(p_user uuid, p_club uuid, p_permission text) returns boolean language plpgsql as $$
begin perform pg_temp.as_user(p_user); return club_private.can(p_club, p_permission); end $$;
create function pg_temp.version(p_club uuid) returns bigint language sql as $$ select role_version from public.club_clubs where id = p_club $$;
-- An owner change (default: o1 in club X) with a fresh request id and the current role version.
create function pg_temp.change(p_user uuid, p_action text, p_club uuid default '00000000-0000-4000-8000-000000000d10', p_actor uuid default '00000000-0000-4000-8000-000000000d01') returns jsonb language plpgsql as $$
begin perform pg_temp.as_user(p_actor); return public.club_change_admin(p_club, p_user, p_action, pg_temp.version(p_club), gen_random_uuid()); end $$;
create function pg_temp.club_events() returns bigint language sql as $$ select count(*) from public.club_audit_events where club_id = '00000000-0000-4000-8000-000000000d10' $$;
-- Runs one statement as o1 and expects the given SQLSTATE.
create function pg_temp.refused(p_sql text, p_state text, p_actor uuid default '00000000-0000-4000-8000-000000000d01') returns void language plpgsql as $$
declare got text;
begin
  perform pg_temp.as_user(p_actor);
  begin execute p_sql; exception when others then got := sqlstate; end;
  if got is distinct from p_state then raise exception 'Expected % but got % for: %', p_state, coalesce(got, 'success'), p_sql; end if;
end $$;

-- 1. Only the owner of this club holds the new powers; they are non-delegable and never reach an admin by default.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10';
begin
  if (select count(*) from public.auth_permissions where key in ('club.admins.manage','club.admins.permissions') and non_delegable and sensitive and allowed_scopes = '{club}') <> 2 then raise exception 'Stage C permissions not registered as non-delegable'; end if;
  if not pg_temp.can_as('00000000-0000-4000-8000-000000000d01', x, 'club.admins.manage') or not pg_temp.can_as('00000000-0000-4000-8000-000000000d01', x, 'club.admins.permissions') then raise exception 'Owner lacks stage C powers'; end if;
  if pg_temp.can_as('00000000-0000-4000-8000-000000000d02', x, 'club.admins.manage') or pg_temp.can_as('00000000-0000-4000-8000-000000000d05', x, 'club.admins.manage')
    or pg_temp.can_as('00000000-0000-4000-8000-000000000d09', x, 'club.admins.permissions') then raise exception 'Stage C power outside the owner of this club'; end if;
end $$;

-- 2. Admin, another club's owner, an outsider, an unconfirmed account and anon are refused by every owner RPC on club X.
set local role authenticated;
do $$
declare who uuid; f text;
begin
  foreach who in array array['00000000-0000-4000-8000-000000000d02','00000000-0000-4000-8000-000000000d05','00000000-0000-4000-8000-000000000d07','00000000-0000-4000-8000-000000000d08']::uuid[] loop
    perform set_config('request.jwt.claim.sub', who::text, true); perform set_config('request.jwt.claims', '{}', true);
    foreach f in array array[
      $q$select public.club_team_admins('00000000-0000-4000-8000-000000000d10')$q$,
      $q$select public.club_team_permissions('00000000-0000-4000-8000-000000000d10')$q$,
      $q$select public.club_admin_candidate('00000000-0000-4000-8000-000000000d10','c1@team.test')$q$,
      $q$select public.club_change_admin('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d04','grant',0,gen_random_uuid())$q$,
      $q$select public.club_change_admin('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d03','revoke',0,gen_random_uuid())$q$,
      $q$select public.club_set_admin_default('00000000-0000-4000-8000-000000000d10','club.rename',true)$q$,
      $q$select public.club_set_admin_permission('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d03','club.rename',true)$q$] loop
      begin execute f; raise exception '% ran %', who, f; exception when insufficient_privilege then null; end;
    end loop;
  end loop;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.club_team_admins('00000000-0000-4000-8000-000000000d10'); raise exception 'anon read the team'; exception when insufficient_privilege then null; end;
  begin perform public.club_change_admin('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d04','grant',0,gen_random_uuid()); raise exception 'anon appointed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated','club_private.require_role_change(uuid,uuid,text,text)','EXECUTE') or has_function_privilege('authenticated','club_private.permission_explain(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','club_private.owner_settable(uuid,text,boolean)','EXECUTE') or has_function_privilege('service_role','public.club_change_admin(uuid,uuid,text,bigint,uuid)','EXECUTE')
    then raise exception 'Stage C internals reachable by an API role'; end if;
end $$;

-- 3. Appointment, revocation and removal: allowed paths, immediate effect, one club audit row per real change.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; o1 uuid := '00000000-0000-4000-8000-000000000d01'; c1 uuid := '00000000-0000-4000-8000-000000000d04';
  a1 uuid := '00000000-0000-4000-8000-000000000d02'; a2 uuid := '00000000-0000-4000-8000-000000000d03'; r jsonb; n bigint := pg_temp.club_events();
  req uuid := gen_random_uuid(); v0 bigint := pg_temp.version('00000000-0000-4000-8000-000000000d10');
begin
  if pg_temp.can_as(c1, x, 'members.read') then raise exception 'Fixture: c1 already has access'; end if;
  perform pg_temp.as_user(o1); r := public.club_change_admin(x, c1, 'grant', v0, req);
  if not (r->>'changed')::boolean or not pg_temp.can_as(c1, x, 'members.read') then raise exception 'Owner appointment failed: %', r; end if;
  if pg_temp.can_as(c1, x, 'club.admins.manage') then raise exception 'Appointed admin got a management power'; end if;
  if pg_temp.club_events() <> n + 1 or not exists(select 1 from public.club_audit_events where club_id = x and action = 'admin_appointed' and target_id = c1 and actor_id = o1 and details->>'actor_role' = 'owner')
    then raise exception 'Appointment not in the club log'; end if;
  if not exists(select 1 from public.platform_audit_events where actor_id = o1 and action like 'club_memberships.%' and details#>>'{new,user_id}' = c1::text) then raise exception 'Appointment not in the platform log'; end if;
  -- Replaying the same request returns the saved result and logs nothing; reusing the id for another action is refused.
  perform pg_temp.as_user(o1); if public.club_change_admin(x, c1, 'grant', v0, req) <> r or pg_temp.club_events() <> n + 1 then raise exception 'Replay not idempotent'; end if;
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, %L)', x, c1, 'revoke', v0, req), 'PT409');
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, gen_random_uuid())', x, a1, 'revoke', v0), 'PT409'); -- stale version
  -- Appointing an existing admin again is a no-op (no club log row).
  if (pg_temp.change(c1, 'grant')->>'changed')::boolean or pg_temp.club_events() <> n + 1 then raise exception 'Repeat appointment changed something'; end if;
  -- Revocation is immediate in can() and RLS.
  perform pg_temp.as_user(a2); set local role authenticated;
  if not exists(select 1 from public.club_players where club_id = x) then raise exception 'Fixture: a2 cannot read'; end if;
  reset role;
  r := pg_temp.change(a2, 'revoke');
  if not (r->>'changed')::boolean or pg_temp.can_as(a2, x, 'members.read') then raise exception 'Revocation not immediate'; end if;
  perform pg_temp.as_user(a2); set local role authenticated;
  if exists(select 1 from public.club_players where club_id = x) then raise exception 'RLS still shows rows after revocation'; end if;
  reset role;
  r := pg_temp.change(a1, 'remove');
  if not (r->>'changed')::boolean or pg_temp.can_as(a1, x, 'members.read') then raise exception 'Removal failed'; end if;
  if pg_temp.club_events() <> n + 3 or (select array_agg(action order by action) from public.club_audit_events where club_id = x and action like 'admin_%') <> array['admin_appointed','admin_removed','admin_revoked']
    then raise exception 'Role changes not logged once each'; end if;
  -- Revoking or removing someone without a role is a no-op.
  if (pg_temp.change(a1, 'revoke')->>'changed')::boolean or (pg_temp.change(a1, 'remove')->>'changed')::boolean or pg_temp.club_events() <> n + 3 then raise exception 'No-op logged'; end if;
  -- Other clubs and platform identities are untouched.
  if not pg_temp.can_as('00000000-0000-4000-8000-000000000d06', '00000000-0000-4000-8000-000000000d11', 'members.read') then raise exception 'Other club affected'; end if;
end $$;

-- 4. What an owner can never do with role changes.
do $$
declare x text := '00000000-0000-4000-8000-000000000d10'; y text := '00000000-0000-4000-8000-000000000d11';
  stmt text := 'select public.club_change_admin(%L, %L, %L, (select role_version from public.club_clubs where id = %L), gen_random_uuid())';
begin
  -- Themselves (the owner role), a custom-role holder, other clubs.
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d01', 'revoke', x), '42501');
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d01', 'remove', x), '42501');
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d09', 'grant', x), '42501');
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d09', 'remove', x), '42501');
  perform pg_temp.refused(format(stmt, y, '00000000-0000-4000-8000-000000000d06', 'revoke', y), '42501');
  perform pg_temp.refused(format(stmt, y, '00000000-0000-4000-8000-000000000d04', 'grant', y), '42501');
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d05', 'remove', x), '42501', '00000000-0000-4000-8000-000000000d05'); -- Y's owner in X
  -- Stage E: a Super Admin's account is appointed like any confirmed account (refusing it would tell a platform admin,
  -- who sees which accounts are confirmed, who the Super Admin is). Probed and rolled back so later counts are unchanged.
  begin
    perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01'); execute format(stmt, x, 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'grant', x);
    if not exists(select 1 from public.club_memberships where club_id = x::uuid and user_id = 'd0ddb226-a10a-471c-be4b-d5e5153bd313' and role = 'admin' and status = 'active') then raise exception 'Super Admin account treated differently'; end if;
    raise exception using errcode = 'P0001', message = 'probe rollback';
  exception when sqlstate 'P0001' then if sqlerrm <> 'probe rollback' then raise; end if;
  end;
  -- Unconfirmed targets get the same answer as an unknown account.
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-000000000d08', 'grant', x), '22023');
  perform pg_temp.refused(format(stmt, x, '00000000-0000-4000-8000-0000000000ff', 'grant', x), '22023');
  -- Appointing an owner, transferring, or any other action: not an owner path.
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, 0, gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d04', 'transfer'), '22023');
  perform pg_temp.refused(format('select public.platform_assign_role(%L, %L, %L, %L, (select role_version from public.club_clubs where id = %L), gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d07', 'owner', 'grant', x), '42501');
  perform pg_temp.refused(format('select public.platform_assign_role(%L, %L, %L, %L, (select role_version from public.club_clubs where id = %L), gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d07', 'admin', 'grant', x), '42501');
  perform pg_temp.refused(format('select public.platform_transfer_owner(%L, %L, %L, 0, gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d04', 'admin'), '42501');
  perform pg_temp.refused(format('select public.platform_remove_from_club(%L, %L, 0, gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d04'), '42501');
  -- Caps, platform defaults, Super Admin personal settings and the admin limit stay Super Admin only.
  perform pg_temp.refused(format('select public.platform_set_admin_limit(%L, 50)', x), '42501');
  perform pg_temp.refused($q$select public.platform_set_role_permission('cap','admin','club.rename',true)$q$, '42501');
  perform pg_temp.refused($q$select public.platform_set_role_permission('platform_default','admin','club.rename',true)$q$, '42501');
  perform pg_temp.refused(format('select public.platform_set_personal_permission(%L, %L, %L, true)', x, '00000000-0000-4000-8000-000000000d04', 'club.rename'), '42501');
end $$;

-- 5. The admin limit (Super Admin's setting) holds for the owner; the single-role rule is the stage A one.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10';
begin
  -- c1 is the only active admin now (a1, a2 left in step 3); fill to the limit of 3.
  perform pg_temp.change('00000000-0000-4000-8000-000000000d02', 'grant');
  perform pg_temp.change('00000000-0000-4000-8000-000000000d03', 'grant');
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d07', 'grant', pg_temp.version(x)), 'PT409');
  if pg_temp.can_as('00000000-0000-4000-8000-000000000d07', x, 'members.read') then raise exception 'Limit exceeded'; end if;
  -- Y's owner may be an admin of X (one role per club, not per platform) once there is room.
  perform pg_temp.as_super(); perform public.platform_set_admin_limit(x, 4);
  if not (pg_temp.change('00000000-0000-4000-8000-000000000d05', 'grant')->>'changed')::boolean then raise exception 'Cross-club appointment refused'; end if;
  perform pg_temp.change('00000000-0000-4000-8000-000000000d05', 'revoke');
end $$;

-- 6. Club admin defaults: admin role of this club only, within the cap, never non-delegable powers.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; y uuid := '00000000-0000-4000-8000-000000000d11'; o1 uuid := '00000000-0000-4000-8000-000000000d01';
  c1 uuid := '00000000-0000-4000-8000-000000000d04'; n bigint;
begin
  n := pg_temp.club_events();
  perform pg_temp.as_user(o1);
  if public.club_set_admin_default(x, 'club.rename', true) <> '{"changed":true}' then raise exception 'Default not saved'; end if;
  if not pg_temp.can_as(c1, x, 'club.rename') or pg_temp.can_as('00000000-0000-4000-8000-000000000d06', y, 'club.rename') then raise exception 'Default missing or leaked'; end if;
  perform pg_temp.as_user(o1);
  if public.club_set_admin_default(x, 'club.rename', true) <> '{"changed":false}' or pg_temp.club_events() <> n + 1 then raise exception 'Repeat default logged'; end if;
  if not exists(select 1 from public.club_audit_events where club_id = x and action = 'admin_default_changed' and details->>'permission' = 'club.rename' and details->>'new' = 'true' and details->'old' = 'null')
    then raise exception 'Default change not described'; end if;
  if (select role_key from public.club_role_permissions where club_id = x and permission_key = 'club.rename') <> 'admin' then raise exception 'Owner default touched another role'; end if;
  -- Non-delegable powers, platform permissions, unknown keys, capped permissions, other clubs.
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', x, 'club.admins.manage'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, false)', x, 'club.admins.permissions'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', x, 'platform.read'), '22023');
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', x, 'no.such'), '22023');
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', y, 'club.rename'), '42501');
  perform pg_temp.as_super(); perform public.platform_set_role_permission('cap', 'admin', 'imports.delete', false);
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', x, 'imports.delete'), 'PT409');
  perform pg_temp.as_user(o1); perform public.club_set_admin_default(x, 'imports.delete', null); -- follow is always allowed
  if pg_temp.can_as(c1, x, 'imports.delete') then raise exception 'Cap ignored'; end if;
  -- Back to follow: no row, platform default again.
  perform pg_temp.as_user(o1); perform public.club_set_admin_default(x, 'club.rename', null);
  if pg_temp.can_as(c1, x, 'club.rename') or exists(select 1 from public.club_role_permissions where club_id = x and permission_key = 'club.rename') then raise exception 'Follow did not clear'; end if;
end $$;

-- 7. Personal settings for an admin: owner level only, Super Admin forced settings and caps win, deny beats allow.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; o1 uuid := '00000000-0000-4000-8000-000000000d01'; c1 uuid := '00000000-0000-4000-8000-000000000d04'; n bigint := pg_temp.club_events();
begin
  perform pg_temp.as_user(o1);
  if public.club_set_admin_permission(x, c1, 'audit.read', false) <> '{"changed":true}' or pg_temp.can_as(c1, x, 'audit.read') then raise exception 'Owner deny not applied'; end if;
  if (select set_by from public.club_permission_overrides where club_id = x and user_id = c1 and permission_key = 'audit.read') <> 'owner' then raise exception 'Owner row not marked owner'; end if;
  if not exists(select 1 from public.club_audit_events where club_id = x and action = 'admin_permission_changed' and target_id = c1 and details->>'new' = 'false') or pg_temp.club_events() <> n + 1 then raise exception 'Personal change not logged once'; end if;
  -- Deny beats a club default allow.
  perform pg_temp.as_user(o1); perform public.club_set_admin_default(x, 'club.rename', true); perform public.club_set_admin_permission(x, c1, 'club.rename', false);
  if pg_temp.can_as(c1, x, 'club.rename') or not pg_temp.can_as('00000000-0000-4000-8000-000000000d02', x, 'club.rename') then raise exception 'Deny did not beat the club default'; end if;
  -- A Super Admin forced setting wins over the owner's, in both directions.
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, c1, 'audit.read', true);
  if not pg_temp.can_as(c1, x, 'audit.read') then raise exception 'Forced allow lost to owner deny'; end if;
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, c1, 'imports.create', false);
  perform pg_temp.as_user(o1); perform public.club_set_admin_permission(x, c1, 'imports.create', true);
  if pg_temp.can_as(c1, x, 'imports.create') then raise exception 'Owner allow beat a forced deny'; end if;
  if exists(select 1 from public.club_permission_overrides where club_id = x and user_id = c1 and set_by = 'super_admin' and permission_key = 'imports.create' and allowed) then raise exception 'Owner changed the Super Admin row'; end if;
  -- The cap wins and cannot be written around.
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, c1, 'imports.delete'), 'PT409');
  -- Never: themselves, the owner role, a non-admin, another club's admin, non-delegable powers, platform permissions.
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, false)', x, o1, 'members.read'), '42501');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, null)', x, o1, 'members.read'), '42501');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, '00000000-0000-4000-8000-000000000d07', 'members.read'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, '00000000-0000-4000-8000-000000000d09', 'members.read'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, '00000000-0000-4000-8000-000000000d06', 'members.read'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000d06', 'members.read'), '42501');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, c1, 'club.admins.manage'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, c1, 'club.admins.permissions'), 'PT409');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, c1, 'platform.roles.assign'), '22023');
  -- Even a row that slipped in by SQL never hands an admin a management power (stage B safety layer).
  insert into public.club_permission_overrides values (x, c1, 'club.admins.manage', 'owner', true);
  if pg_temp.can_as(c1, x, 'club.admins.manage') then raise exception 'Non-delegable reached an admin'; end if;
  delete from public.club_permission_overrides where club_id = x and user_id = c1 and permission_key = 'club.admins.manage';
end $$;

-- 8. Readers: this club only, the stage B calculation, no Super Admin identity; explanation equals can().
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; o1 uuid := '00000000-0000-4000-8000-000000000d01'; t jsonb; a jsonb; p jsonb;
begin
  insert into public.club_memberships(club_id,user_id,role) values (x, 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'admin'); -- a Super Admin who is also an admin here
  perform pg_temp.as_user(o1); t := public.club_team_admins(x);
  if (t->>'admin_limit')::int <> 4 or (t->>'role_version')::bigint <> pg_temp.version(x)
    or (select array_agg(value->>'email' order by value->>'email') from jsonb_array_elements(t->'admins')) <> array['a1@team.test','a2@team.test','c1@team.test','owner@club.test'] then raise exception 'Team list wrong: %', t; end if;
  if t::text like '%y1@team.test%' or t::text like '%super_admin%' then raise exception 'Team list leaks: %', t; end if;
  perform pg_temp.as_user(o1); t := public.club_team_permissions(x);
  if t::text like '%super_admin"%' or t::text like '%y1@team.test%' then raise exception 'Team permissions leak the Super Admin or another club: %', t; end if;
  if not t->'permissions' @> '[{"key":"club.admins.manage","non_delegable":true},{"key":"imports.delete","cap_blocked":true},{"key":"club.rename","club_default":true}]' then raise exception 'Settings incomplete: %', t->'permissions'; end if;
  for a in select * from jsonb_array_elements(t->'admins') loop
    if a->'explain' ? 'super_admin' then raise exception 'Super Admin flag exposed'; end if;
    if (a->>'user_id')::uuid = 'd0ddb226-a10a-471c-be4b-d5e5153bd313' then continue; end if; -- an active Super Admin's own can() is not the role's
    for p in select * from jsonb_array_elements(a->'explain'->'permissions') loop
      if (p->>'allowed')::boolean <> pg_temp.can_as((a->>'user_id')::uuid, x, p->>'key') then raise exception 'Owner explanation % disagrees with can() for %', p, a->>'email'; end if;
    end loop;
  end loop;
  if not exists(select 1 from jsonb_array_elements(t->'admins') ad, jsonb_array_elements(ad->'explain'->'permissions') pe
    where ad->>'email' = 'c1@team.test' and pe->>'key' = 'audit.read' and pe->>'layer' = 'forced_allow' and pe->>'owner_set' = 'false') then raise exception 'Owner cannot see why the Super Admin setting wins'; end if;
  -- Candidate lookup: unknown and unverified accounts get the same answer; a Super Admin's account is found like any
  -- confirmed account (stage E, see above).
  perform pg_temp.as_user(o1);
  if (public.club_admin_candidate(x, '  OWNER@club.test ')->>'user_id')::uuid <> 'd0ddb226-a10a-471c-be4b-d5e5153bd313' then raise exception 'Super Admin account not found like others'; end if;
  foreach a in array array['"nobody@team.test"','"u1@team.test"']::jsonb[] loop
    begin perform pg_temp.as_user(o1); perform public.club_admin_candidate(x, a#>>'{}'); raise exception 'Candidate found: %', a;
    exception when sqlstate '22023' then if sqlerrm not like '找不到可任命的账户%' then raise exception 'Different answer for %: %', a, sqlerrm; end if; end;
  end loop;
  delete from public.club_memberships where club_id = x and user_id = 'd0ddb226-a10a-471c-be4b-d5e5153bd313';
end $$;

-- 9. Re-appointment: kept personal settings apply again, and the candidate lookup reports them beforehand.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; o1 uuid := '00000000-0000-4000-8000-000000000d01'; a1 uuid := '00000000-0000-4000-8000-000000000d02'; k jsonb;
begin
  perform pg_temp.as_user(o1); perform public.club_set_admin_default(x, 'audit.read', false); perform public.club_set_admin_permission(x, a1, 'audit.read', true);
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, a1, 'aliases.manage', false);
  if not pg_temp.can_as(a1, x, 'audit.read') then raise exception 'Fixture: owner allow'; end if;
  perform pg_temp.change(a1, 'revoke');
  if pg_temp.can_as(a1, x, 'audit.read') or (select count(*) from public.club_permission_overrides where club_id = x and user_id = a1) <> 2 then raise exception 'Overrides not kept or still effective'; end if;
  perform pg_temp.as_user(o1); k := public.club_admin_candidate(x, ' A1@team.test ');
  if k->>'user_id' <> a1::text or k->>'role' is not null or jsonb_array_length(k->'kept') <> 2
    or not k->'kept' @> '[{"key":"audit.read","sensitive":true,"owner_set":true,"forced":null,"default_allowed":false,"allowed":true},{"key":"aliases.manage","forced":false,"owner_set":null,"default_allowed":true,"allowed":false}]'
    then raise exception 'Re-appointment warning data wrong: %', k; end if;
  if k::text like '%super_admin"%' or k::text like '%Team Y%' then raise exception 'Candidate leaks: %', k; end if;
  perform pg_temp.change(a1, 'grant');
  if not pg_temp.can_as(a1, x, 'audit.read') or pg_temp.can_as(a1, x, 'aliases.manage') then raise exception 'Kept settings did not apply again as reported'; end if;
end $$;

-- 10. The owner's own powers follow the Super Admin's cap and revocation at once; the Super Admin path is unchanged.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000d10'; n bigint;
begin
  perform pg_temp.as_super(); perform public.platform_set_role_permission('cap', 'owner', 'club.admins.manage', false);
  perform pg_temp.refused(format('select public.club_team_admins(%L)', x), '42501');
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, gen_random_uuid())', x, '00000000-0000-4000-8000-000000000d02', 'revoke', pg_temp.version(x)), '42501');
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01'); perform public.club_team_permissions(x); -- the other power is separate
  perform pg_temp.as_super(); perform public.platform_set_role_permission('cap', 'owner', 'club.admins.manage', true);
  n := pg_temp.club_events();
  perform pg_temp.as_super(); perform public.platform_assign_role(x, '00000000-0000-4000-8000-000000000d02', 'admin', 'revoke', pg_temp.version(x), gen_random_uuid());
  if pg_temp.can_as('00000000-0000-4000-8000-000000000d02', x, 'members.read') or pg_temp.club_events() <> n then raise exception 'Super Admin path changed'; end if;
end $$;
-- 9. Review fixes. (a) An owner can never hand admins more than they hold: a Super Admin forced deny on the owner
-- cannot be bypassed by appointing a second account and allowing it there. Deny and follow stay possible.
-- (b) A stale request for a Super Admin's id answers like any other id (version conflict), so it reveals nothing.
reset role;
insert into public.club_permission_overrides(club_id,user_id,permission_key,allowed,set_by)
 values ('00000000-0000-4000-8000-000000000d10','00000000-0000-4000-8000-000000000d01','aliases.manage',false,'super_admin')
 on conflict do nothing;
set local role authenticated;
do $$
declare x text := '00000000-0000-4000-8000-000000000d10'; ad text; n bigint;
begin
  if pg_temp.can_as('00000000-0000-4000-8000-000000000d01', x::uuid, 'aliases.manage') then raise exception 'Fixture: owner still holds aliases.manage'; end if;
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, true)', x, 'aliases.manage'), '42501');
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01');
  -- Narrowing is always allowed; returning to a default that would allow it again is granting, and is refused.
  perform public.club_set_admin_default(x::uuid, 'aliases.manage', false);
  perform pg_temp.refused(format('select public.club_set_admin_default(%L, %L, null)', x, 'aliases.manage'), '42501');
  reset role;
  if not exists(select 1 from public.club_role_permissions where club_id = x::uuid and role_key = 'admin' and permission_key = 'aliases.manage' and not allowed) then raise exception 'Refused follow changed the default'; end if;
  set local role authenticated;
  -- Personal 单独禁止 → 跟随默认: while the admin default denies it the result stays denied (allowed); once the default
  -- would allow it again the follow is granting (refused: the override stays and no audit row is written).
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01');
  -- Earlier blocks changed club X's admins; this block brings its own (outsider n1 becomes an admin).
  ad := '00000000-0000-4000-8000-000000000d07';
  reset role;
  insert into public.club_memberships(club_id,user_id,role) values (x::uuid, ad::uuid, 'admin') on conflict (club_id,user_id,role) do update set status = 'active';
  set local role authenticated;
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01');
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, true)', x, ad, 'aliases.manage'), '42501');
  perform public.club_set_admin_permission(x::uuid, ad::uuid, 'aliases.manage', false);
  perform public.club_set_admin_permission(x::uuid, ad::uuid, 'aliases.manage', null);
  perform public.club_set_admin_permission(x::uuid, ad::uuid, 'aliases.manage', false);
  reset role;
  delete from public.club_role_permissions where club_id = x::uuid and role_key = 'admin' and permission_key = 'aliases.manage';
  n := pg_temp.club_events();
  set local role authenticated;
  perform pg_temp.refused(format('select public.club_set_admin_permission(%L, %L, %L, null)', x, ad, 'aliases.manage'), '42501');
  reset role;
  if not exists(select 1 from public.club_permission_overrides where club_id = x::uuid and user_id = ad::uuid and permission_key = 'aliases.manage' and set_by = 'owner' and not allowed)
    or pg_temp.club_events() <> n then raise exception 'Refused personal follow changed something'; end if;
  set local role authenticated;
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01');
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, gen_random_uuid())', x, 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'grant', 999999), 'PT409');
  perform pg_temp.refused(format('select public.club_change_admin(%L, %L, %L, %s, gen_random_uuid())', x, '00000000-0000-4000-8000-0000000000ff', 'grant', 999999), 'PT409');
end $$;
reset role;
select set_config('request.jwt.claims','',true), set_config('request.jwt.claim.sub','',true);

select 'owner_admins: owner-only non-delegable powers, refusals, own club and admins only, limit, single role, caps and forced settings win, deny beats allow, audit, immediate revocation, re-appointment warning passed' as result;
