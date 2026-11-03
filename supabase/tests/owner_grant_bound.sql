-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Plan A (2026-11-03): an owner grants admins only what they hold as this club's owner. Holding a permission through
-- an alliance-leader read must not widen admins; the alliance read itself and the Super Admin writers are unchanged;
-- a later owner cap does not revoke earlier admin grants (permission_layer unchanged).
-- Club X 0e10: owner o1 0e01 (also leader of alliance 0e30, which X belongs to), admin a1 0e02. Club Y 0e11: owner o2 0e05.
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000e01','o1@bound.test',now()),
 ('00000000-0000-4000-8000-000000000e02','a1@bound.test',now()),
 ('00000000-0000-4000-8000-000000000e05','o2@bound.test',now());
insert into public.club_clubs(id,name,admin_limit) values ('00000000-0000-4000-8000-000000000e10','Bound X',3),('00000000-0000-4000-8000-000000000e11','Bound Y',3);
insert into public.club_memberships(club_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000e10','00000000-0000-4000-8000-000000000e01','owner'),
 ('00000000-0000-4000-8000-000000000e10','00000000-0000-4000-8000-000000000e02','admin'),
 ('00000000-0000-4000-8000-000000000e11','00000000-0000-4000-8000-000000000e05','owner');
insert into public.club_alliances(id,name) values ('00000000-0000-4000-8000-000000000e30','Bound alliance');
insert into public.club_alliance_members(alliance_id,club_id) values ('00000000-0000-4000-8000-000000000e30','00000000-0000-4000-8000-000000000e10');
insert into public.alliance_leaders(alliance_id,user_id) values ('00000000-0000-4000-8000-000000000e30','00000000-0000-4000-8000-000000000e01');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000ef01','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('00000000-0000-4000-8000-00000000ec01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000ef01');
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000ef01');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claims', '{}', true);
$$;
create function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'd0ddb226-a10a-471c-be4b-d5e5153bd313', true), set_config('request.jwt.claims', '{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000ec01"}', true);
$$;
create function pg_temp.can_as(p_user uuid, p_club uuid, p_permission text) returns boolean language plpgsql as $$
begin perform pg_temp.as_user(p_user); return club_private.can(p_club, p_permission); end $$;
create function pg_temp.refused(p_sql text, p_state text, p_actor uuid default '00000000-0000-4000-8000-000000000e01') returns void language plpgsql as $$
declare got text;
begin
  perform pg_temp.as_user(p_actor);
  begin execute p_sql; exception when others then got := sqlstate; end;
  if got is distinct from p_state then raise exception 'Expected % but got % for: %', p_state, coalesce(got, 'success'), p_sql; end if;
end $$;

do $$
declare x uuid := '00000000-0000-4000-8000-000000000e10'; y uuid := '00000000-0000-4000-8000-000000000e11';
  o1 uuid := '00000000-0000-4000-8000-000000000e01'; a1 uuid := '00000000-0000-4000-8000-000000000e02'; o2 uuid := '00000000-0000-4000-8000-000000000e05';
begin
  -- Setup while the owner still holds audit.read: an earlier grant, and two denies that a later "follow" would lift.
  perform pg_temp.as_user(o1);
  if public.club_set_admin_permission(x, a1, 'audit.read', true) <> '{"changed":true}' then raise exception 'Owner could not grant a held permission'; end if;
  perform public.club_set_admin_permission(x, a1, 'members.read', false);
  perform public.club_set_admin_default(x, 'imports.delete', false);
  -- The Super Admin caps the owner role: audit.read, members.read and imports.delete.
  insert into public.auth_role_cap_blocks(role_key, permission_key) values ('owner','audit.read'),('owner','members.read'),('owner','imports.delete');

  -- The alliance read stays: o1 still reads X through the leader path (read-only), but not through the owner role.
  if not pg_temp.can_as(o1, x, 'audit.read') or not pg_temp.can_as(o1, x, 'members.read') then raise exception 'Alliance leader read lost'; end if;
  if club_private.layer_allows(club_private.permission_layer(x, o1, 'owner', 'audit.read')) then raise exception 'Owner cap not applied'; end if;
  -- Accepted rule: the earlier owner grant still counts for the admin (no dynamic bound).
  if not pg_temp.can_as(a1, x, 'audit.read') then raise exception 'Earlier admin grant revoked by the owner cap'; end if;

  -- Rule 1 on every widening path. The alliance read must not count; the caller must hold it as owner.
  perform pg_temp.refused($q$select public.club_set_admin_default('00000000-0000-4000-8000-000000000e10', 'audit.read', true)$q$, '42501');
  perform pg_temp.refused($q$select public.club_set_admin_permission('00000000-0000-4000-8000-000000000e10', '00000000-0000-4000-8000-000000000e02', 'members.read', true)$q$, '42501');
  -- "单独禁止 → 跟随默认" would turn a1's members.read on (platform admin default allows it).
  perform pg_temp.refused($q$select public.club_set_admin_permission('00000000-0000-4000-8000-000000000e10', '00000000-0000-4000-8000-000000000e02', 'members.read', null)$q$, '42501');
  -- "不允许 → 跟随全平台" would turn the admin default for imports.delete on.
  perform pg_temp.refused($q$select public.club_set_admin_default('00000000-0000-4000-8000-000000000e10', 'imports.delete', null)$q$, '42501');
  -- Refusals left nothing behind.
  if pg_temp.can_as(a1, x, 'members.read') or not exists(select 1 from public.club_role_permissions where club_id = x and role_key = 'admin' and permission_key = 'imports.delete' and not allowed)
    then raise exception 'Refused change was not rolled back'; end if;
  -- Narrowing is always allowed, and so is granting what the owner still holds.
  perform pg_temp.as_user(o1);
  perform public.club_set_admin_permission(x, a1, 'audit.read', false);
  if pg_temp.can_as(a1, x, 'audit.read') then raise exception 'Owner deny not applied'; end if;
  perform pg_temp.as_user(o1);
  if public.club_set_admin_default(x, 'aliases.manage', true) <> '{"changed":true}' then raise exception 'Owner could not grant a held default'; end if;

  -- The check is bound to the caller as owner of THIS club: o2 owns Y, not X.
  perform pg_temp.refused($q$select public.club_set_admin_default('00000000-0000-4000-8000-000000000e10', 'aliases.manage', true)$q$, '42501', '00000000-0000-4000-8000-000000000e05');
  -- The writers' require() already stops o2; the helper itself must also ask about the caller, not any owner of X.
  perform pg_temp.as_user(o2);
  if club_private.caller_owner_holds(x, 'aliases.manage') then raise exception 'Owner check not bound to the caller'; end if;
  perform pg_temp.as_user(a1);
  if club_private.caller_owner_holds(x, 'aliases.manage') then raise exception 'Admin counted as owner'; end if;
  perform pg_temp.as_user(o1);
  if not club_private.caller_owner_holds(x, 'aliases.manage') then raise exception 'Owner check refuses the real owner'; end if;

  -- Super Admin writers are unaffected, through the platform interface and through the same owner writers.
  perform pg_temp.as_super();
  perform public.platform_set_personal_permission(x, a1, 'members.read', true);
  if not pg_temp.can_as(a1, x, 'members.read') then raise exception 'Super Admin forced allow lost'; end if;
  perform pg_temp.as_super();
  if public.club_set_admin_default(x, 'imports.delete', null) <> '{"changed":true}' then raise exception 'Super Admin blocked on the owner writer'; end if;

  -- Lifting the cap lets the owner grant again (decided now, nothing stored about the past).
  delete from public.auth_role_cap_blocks where role_key = 'owner' and permission_key = 'audit.read';
  perform pg_temp.as_user(o1);
  perform public.club_set_admin_permission(x, a1, 'audit.read', true);
  if not pg_temp.can_as(a1, x, 'audit.read') then raise exception 'Grant after lifting the cap failed'; end if;
end $$;
