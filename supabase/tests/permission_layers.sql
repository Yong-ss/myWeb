-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- Permissions V1 stage B: layered permissions decided only by can(). Without layer rows the result is exactly the old
-- rule; with them the order is safety > cap > Super Admin forced > owner-set (admins only) > club default > platform
-- default. Only an active Super Admin can change layers, every change is in the platform log, and the explanation
-- the settings screen shows always equals what can() grants.
-- Club X (0b10): owner b01, admin b02, unconfirmed admin b05, custom role b06. Club Y (0b11): admin b03. b04 has no role.
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000b01','x-owner@layers.test',now()),
 ('00000000-0000-4000-8000-000000000b02','x-admin@layers.test',now()),
 ('00000000-0000-4000-8000-000000000b03','y-admin@layers.test',now()),
 ('00000000-0000-4000-8000-000000000b04','nobody@layers.test',now()),
 ('00000000-0000-4000-8000-000000000b05','unconfirmed@layers.test',null),
 ('00000000-0000-4000-8000-000000000b06','viewer@layers.test',now());
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-000000000b10','Layers X'),('00000000-0000-4000-8000-000000000b11','Layers Y');
insert into public.auth_roles(key,scope_kind,club_id,name) values ('x_viewer','club','00000000-0000-4000-8000-000000000b10','X 查看');
insert into public.auth_role_permissions values ('x_viewer','members.read');
insert into public.club_memberships(club_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b01','owner'),
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','admin'),
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b05','admin'),
 ('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b06','x_viewer'),
 ('00000000-0000-4000-8000-000000000b11','00000000-0000-4000-8000-000000000b03','admin');
insert into public.club_players(id,club_id,display_name) values ('00000000-0000-4000-8000-000000000b20','00000000-0000-4000-8000-000000000b10','X player');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('00000000-0000-4000-8000-00000000bf01','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000bc01','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000bf01'),
 ('00000000-0000-4000-8000-00000000bc02','00000000-0000-4000-8000-000000000b01','aal2',null);
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000bf01');

-- can() for one user without MFA claims; and the pre-stage-B rule written out, as the equivalence reference.
create function pg_temp.can_as(p_user uuid, p_club uuid, p_permission text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true); perform set_config('request.jwt.claims', '{}', true);
  return club_private.can(p_club, p_permission);
end $$;
create function pg_temp.old_can(p_user uuid, p_club uuid, p_permission text) returns boolean language sql as $$
  select exists(select 1 from public.auth_permissions where key = p_permission and 'club' = any(allowed_scopes))
    and exists(select 1 from auth.users where id = p_user and email_confirmed_at is not null)
    and exists(select 1 from public.club_memberships m
      join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
      join public.auth_role_permissions rp on rp.role_key = m.role
      where m.club_id = p_club and m.user_id = p_user and m.status = 'active' and rp.permission_key = p_permission);
$$;
create function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'd0ddb226-a10a-471c-be4b-d5e5153bd313', true), set_config('request.jwt.claims', '{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000bc01"}', true);
$$;
-- Explanation (as the Super Admin) and can() (as the user) must agree for every user, club and club permission.
create function pg_temp.check_explain(p_label text) returns void language plpgsql as $$
declare u uuid; c uuid; e jsonb; p jsonb;
begin
  foreach c in array array['00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b11']::uuid[] loop
    foreach u in array array['00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02','00000000-0000-4000-8000-000000000b03',
      '00000000-0000-4000-8000-000000000b04','00000000-0000-4000-8000-000000000b05','00000000-0000-4000-8000-000000000b06']::uuid[] loop
      perform pg_temp.as_super(); e := public.platform_permission_explain(c, u);
      for p in select * from jsonb_array_elements(e->'permissions') loop
        if (p->>'allowed')::boolean <> pg_temp.can_as(u, c, p->>'key') then raise exception '%: explanation % disagrees with can() for % in %', p_label, p, u, c; end if;
      end loop;
    end loop;
  end loop;
end $$;
create function pg_temp.layer(p_user uuid, p_permission text) returns text language plpgsql as $$
begin
  perform pg_temp.as_super();
  return (select value->>'layer' from jsonb_array_elements(public.platform_permission_explain('00000000-0000-4000-8000-000000000b10', p_user)->'permissions') where value->>'key' = p_permission);
end $$;

-- 1. Equivalence: with no layer rows, can() equals the previous rule for every user, club and registered permission.
do $$
declare u record; c uuid; p text; n int := 0;
begin
  if exists(select 1 from public.auth_role_cap_blocks) or exists(select 1 from public.club_role_permissions) or exists(select 1 from public.club_permission_overrides)
    or exists(select 1 from public.auth_permissions where non_delegable and key not like 'club.admins.%' and key <> 'club.alliance.request') then raise exception 'Fresh database already has layer rows'; end if;
  for u in select id from auth.users loop
    foreach c in array array['00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b11','ce0c7103-1cdf-4b08-8619-f71d4915f598']::uuid[] loop
      for p in select key from public.auth_permissions union all select 'not.registered' loop
        if pg_temp.can_as(u.id, c, p) <> pg_temp.old_can(u.id, c, p) then raise exception 'Equivalence broken for % % %', u.id, c, p; end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  if n < 100 then raise exception 'Equivalence covered too little (%)', n; end if;
  perform pg_temp.check_explain('no layers');
end $$;

-- 2. Nobody but an active Super Admin can change or read layers; tables are closed to every API role.
set local role authenticated;
do $$
declare who record; f text;
begin
  for who in select * from (values
    ('00000000-0000-4000-8000-000000000b01','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000bc02"}','club owner at aal2'),
    ('00000000-0000-4000-8000-000000000b02','{}','club admin'),
    ('d0ddb226-a10a-471c-be4b-d5e5153bd313','{"aal":"aal1"}','Super Admin at aal1')) v(id,claims,label) loop
    perform set_config('request.jwt.claim.sub',who.id,true); perform set_config('request.jwt.claims',who.claims,true);
    foreach f in array array[
      $q$select public.platform_set_role_permission('club_default','admin','club.rename',true,'00000000-0000-4000-8000-000000000b10')$q$,
      $q$select public.platform_set_role_permission('platform_default','admin','club.rename',true)$q$,
      $q$select public.platform_set_personal_permission('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','club.rename',true)$q$,
      $q$select public.platform_permission_settings()$q$,
      $q$select public.platform_permission_explain('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02')$q$] loop
      begin execute f; raise exception '% ran %', who.label, f; exception when insufficient_privilege then null; end;
    end loop;
    foreach f in array array['auth_role_cap_blocks','club_role_permissions','club_permission_overrides'] loop
      begin execute format('select 1 from public.%I', f); raise exception '% read %', who.label, f; exception when insufficient_privilege then null; end;
      begin execute format('delete from public.%I', f); raise exception '% deleted %', who.label, f; exception when insufficient_privilege then null; end;
    end loop;
  end loop;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated','club_private.permission_layer(uuid,uuid,text,text)','EXECUTE') or has_function_privilege('authenticated','club_private.layer_allows(text)','EXECUTE')
    or has_table_privilege('service_role','public.club_permission_overrides','SELECT') or has_table_privilege('anon','public.club_role_permissions','SELECT')
    then raise exception 'Layer internals reachable by an API role'; end if;
  if (select count(*) from pg_class where relname in ('auth_role_cap_blocks','club_role_permissions','club_permission_overrides') and relrowsecurity) <> 3 then raise exception 'RLS not enabled on layer tables'; end if;
end $$;

-- 3. Validation: fixed club roles, club-scope permissions only, explicit layer/club pairing, personal only for role holders.
do $$
declare f text;
begin
  perform pg_temp.as_super();
  foreach f in array array[
    $q$select public.platform_set_role_permission('bogus','admin','club.rename',true)$q$,
    $q$select public.platform_set_role_permission('platform_default','x_viewer','club.rename',true)$q$,
    $q$select public.platform_set_role_permission('platform_default','admin','platform.read',true)$q$,
    $q$select public.platform_set_role_permission('platform_default','admin','club.rename',null)$q$,
    $q$select public.platform_set_role_permission('club_default','admin','club.rename',true)$q$,
    $q$select public.platform_set_role_permission('cap','admin','club.rename',false,'00000000-0000-4000-8000-000000000b10')$q$,
    $q$select public.platform_set_role_permission('club_default','admin','club.rename',true,'00000000-0000-4000-8000-0000000000ff')$q$,
    $q$select public.platform_set_personal_permission(null,'00000000-0000-4000-8000-000000000b02','club.rename',true)$q$,
    $q$select public.platform_set_personal_permission('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','platform.roles.assign',true)$q$,
    $q$select public.platform_permission_explain('00000000-0000-4000-8000-0000000000ff','00000000-0000-4000-8000-000000000b02')$q$] loop
    begin execute f; raise exception 'Accepted: %', f; exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.platform_set_personal_permission('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b04','club.rename',true);
    raise exception 'Personal permission for a user without a role'; exception when sqlstate 'PT409' then null; end;
  -- Direct writes (SQL Editor) are held to the same scope rule.
  begin insert into public.club_role_permissions values ('00000000-0000-4000-8000-000000000b10','admin','platform.read',true); raise exception 'Platform permission as club default'; exception when sqlstate '23514' then null; end;
  begin insert into public.auth_role_cap_blocks values ('x_viewer','members.read'); raise exception 'Custom role cap'; exception when check_violation then null; end;
end $$;

-- 4. Layer order, step by step, with the Super Admin RPCs. Every change is immediate for the affected users only.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000b10'; y uuid := '00000000-0000-4000-8000-000000000b11';
  owner uuid := '00000000-0000-4000-8000-000000000b01'; admin uuid := '00000000-0000-4000-8000-000000000b02'; y_admin uuid := '00000000-0000-4000-8000-000000000b03';
  r jsonb;
begin
  -- ⑥ platform default: admins cannot rename.
  if pg_temp.can_as(admin, x, 'club.rename') or pg_temp.layer(admin, 'club.rename') <> 'default_deny' then raise exception 'Platform default not applied'; end if;
  -- ⑤ club default allows renaming in X only; other clubs keep the platform default.
  perform pg_temp.as_super(); r := public.platform_set_role_permission('club_default','admin','club.rename',true,x);
  if r <> '{"changed":true}' then raise exception 'Club default not saved: %', r; end if;
  if not pg_temp.can_as(admin, x, 'club.rename') or pg_temp.can_as(y_admin, y, 'club.rename') then raise exception 'Club default leaked or missing'; end if;
  if pg_temp.layer(admin, 'club.rename') <> 'club_allow' then raise exception 'Club default reason wrong'; end if;
  perform pg_temp.as_super(); if public.platform_set_role_permission('club_default','admin','club.rename',true,x) <> '{"changed":false}' then raise exception 'Repeat reported as change'; end if;
  -- ④ owner-set personal deny (stage C writes these; inserted directly here) wins over the club default, for admins only.
  insert into public.club_permission_overrides values (x, admin, 'club.rename', 'owner', false), (x, owner, 'club.rename', 'owner', false);
  if pg_temp.can_as(admin, x, 'club.rename') or pg_temp.layer(admin, 'club.rename') <> 'owner_deny' then raise exception 'Owner-set deny not applied'; end if;
  if not pg_temp.can_as(owner, x, 'club.rename') then raise exception 'Owner-level override restricted the owner'; end if;
  -- ③ Super Admin forced allow wins over the owner-set deny on the same permission; forced deny wins over the club default.
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, admin, 'club.rename', true);
  if not pg_temp.can_as(admin, x, 'club.rename') or pg_temp.layer(admin, 'club.rename') <> 'forced_allow' then raise exception 'Forced allow did not win'; end if;
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, admin, 'imports.create', false);
  if pg_temp.can_as(admin, x, 'imports.create') or not pg_temp.can_as(owner, x, 'imports.create') or pg_temp.layer(admin, 'imports.create') <> 'forced_deny' then raise exception 'Forced deny wrong'; end if;
  -- Deny is enforced by RLS too: forced deny of members.read hides the club's rows from that admin alone.
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, admin, 'members.read', false);
  perform set_config('request.jwt.claim.sub', admin::text, true); perform set_config('request.jwt.claims', '{}', true);
  set local role authenticated;
  if exists(select 1 from public.club_players where club_id = x) then raise exception 'RLS ignored a forced deny'; end if;
  if 'members.read' = any(public.club_my_permissions(x)) or public.club_my_access(x)->'permissions' ? 'members.read' then raise exception 'Worker read ignored a forced deny'; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  if not exists(select 1 from public.club_players where club_id = x) then raise exception 'Owner lost rows'; end if;
  reset role;
  -- ② a cap blocks every lower layer, including a forced allow; the override is kept and returns when the cap is lifted.
  perform pg_temp.as_super(); perform public.platform_set_role_permission('cap','admin','club.rename',false);
  if pg_temp.can_as(admin, x, 'club.rename') or pg_temp.layer(admin, 'club.rename') <> 'cap' then raise exception 'Cap did not limit a forced allow'; end if;
  if not exists(select 1 from public.club_permission_overrides where user_id = admin and permission_key = 'club.rename' and set_by = 'super_admin' and allowed) then raise exception 'Override dropped by cap'; end if;
  if not pg_temp.can_as(owner, x, 'club.rename') then raise exception 'Admin cap limited the owner'; end if;
  perform pg_temp.as_super(); perform public.platform_set_role_permission('cap','admin','club.rename',true);
  if not pg_temp.can_as(admin, x, 'club.rename') then raise exception 'Lifting the cap did not restore the override'; end if;
  -- ⑥ changing a platform default applies at once to everyone without an override, in every club.
  perform pg_temp.as_super(); perform public.platform_set_role_permission('platform_default','admin','aliases.manage',false);
  if pg_temp.can_as(y_admin, y, 'aliases.manage') or pg_temp.can_as(admin, x, 'aliases.manage') then raise exception 'Platform default change not followed'; end if;
  perform pg_temp.as_super(); perform public.platform_set_role_permission('club_default','admin','aliases.manage',true,x);
  if not pg_temp.can_as(admin, x, 'aliases.manage') or pg_temp.can_as(y_admin, y, 'aliases.manage') then raise exception 'Club default vs platform default wrong'; end if;
  -- Clearing returns to "follow".
  perform pg_temp.as_super(); perform public.platform_set_role_permission('club_default','admin','aliases.manage',null,x);
  perform pg_temp.as_super(); perform public.platform_set_personal_permission(x, admin, 'club.rename', null);
  if pg_temp.can_as(admin, x, 'aliases.manage') or pg_temp.layer(admin, 'club.rename') <> 'owner_deny' then raise exception 'Clearing did not fall back'; end if;
  -- An active Super Admin keeps every power regardless of layers on their own membership.
  insert into public.club_memberships(club_id,user_id,role) values (x, 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'admin');
  insert into public.club_permission_overrides values (x, 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'members.read', 'super_admin', false);
  perform pg_temp.as_super(); if not club_private.can(x, 'members.read') then raise exception 'Layers limited an active Super Admin'; end if;
  perform pg_temp.check_explain('layered');
  -- The platform user list shows the same calculation.
  perform pg_temp.as_super();
  if (public.platform_users('x-admin@layers.test')->'users'->0->'effective'->0->'permissions') <> (select to_jsonb(array_agg(key order by key)) from public.auth_permissions where pg_temp.can_as(admin, x, key))
    then raise exception 'platform_users effective differs from can()'; end if;
end $$;

-- 5. Non-delegable permissions never reach a non-owner role, through any layer, even by direct SQL.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000b10'; admin uuid := '00000000-0000-4000-8000-000000000b02'; f text;
begin
  insert into public.auth_permissions(key,kind,allowed_scopes,read_only,sensitive,non_delegable,description) values ('test.manage','action','{club}',false,true,true,'测试管理权');
  insert into public.auth_role_permissions values ('owner','test.manage');
  if not pg_temp.can_as('00000000-0000-4000-8000-000000000b01', x, 'test.manage') then raise exception 'Owner lost a non-delegable default'; end if;
  begin insert into public.auth_role_permissions values ('admin','test.manage'); raise exception 'Non-delegable platform default for admin'; exception when sqlstate '23514' then null; end;
  begin insert into public.auth_role_permissions values ('x_viewer','test.manage'); raise exception 'Non-delegable for custom role'; exception when sqlstate '23514' then null; end;
  begin insert into public.club_role_permissions values (x,'admin','test.manage',true); raise exception 'Non-delegable club default for admin'; exception when sqlstate '23514' then null; end;
  perform pg_temp.as_super();
  foreach f in array array[$q$select public.platform_set_role_permission('platform_default','admin','test.manage',true)$q$,
    $q$select public.platform_set_role_permission('club_default','admin','test.manage',true,'00000000-0000-4000-8000-000000000b10')$q$,
    $q$select public.platform_set_role_permission('cap','admin','test.manage',true)$q$,
    $q$select public.platform_set_personal_permission('00000000-0000-4000-8000-000000000b10','00000000-0000-4000-8000-000000000b02','test.manage',true)$q$] loop
    begin execute f; raise exception 'Accepted: %', f; exception when sqlstate 'PT409' then null; end;
  end loop;
  -- Even a row that slipped in (personal rows are not role-bound) is ignored by the safety layer.
  insert into public.club_permission_overrides values (x, admin, 'test.manage', 'super_admin', true), (x, admin, 'test.manage', 'owner', true);
  if pg_temp.can_as(admin, x, 'test.manage') or pg_temp.layer(admin, 'test.manage') <> 'non_delegable' then raise exception 'Non-delegable reached an admin'; end if;
  -- The marker cannot be removed in place.
  begin update public.auth_permissions set non_delegable = false where key = 'test.manage'; raise exception 'Non-delegable marker removed'; exception when sqlstate '23514' then null; end;
  update public.auth_permissions set non_delegable = true where key = 'members.read';
  if pg_temp.can_as(admin, x, 'members.read') then raise exception 'Newly marked permission still reaches admins'; end if;
  perform pg_temp.check_explain('non-delegable');
end $$;

-- 6. Every change is in the append-only platform log with the actor; repeats add nothing; tables cannot be wiped.
do $$
declare x uuid := '00000000-0000-4000-8000-000000000b10'; before_count int; e record; seen uuid[] := (select array_agg(id) from public.platform_audit_events);
begin
  before_count := (select count(*) from public.platform_audit_events);
  perform pg_temp.as_super();
  perform public.platform_set_role_permission('cap','owner','imports.delete',false);
  perform public.platform_set_role_permission('cap','owner','imports.delete',false);
  perform public.platform_set_role_permission('club_default','owner','imports.delete',false,x);
  perform public.platform_set_personal_permission(x,'00000000-0000-4000-8000-000000000b02','audit.read',false);
  perform public.platform_set_personal_permission(x,'00000000-0000-4000-8000-000000000b02','audit.read',true);
  perform public.platform_set_role_permission('platform_default','owner','imports.delete',false);
  if (select count(*) from public.platform_audit_events) - before_count <> 5 then raise exception 'Layer changes not logged exactly once each'; end if;
  for e in select * from public.platform_audit_events where id <> all(seen) loop
    if e.actor_id is distinct from 'd0ddb226-a10a-471c-be4b-d5e5153bd313'::uuid then raise exception 'Layer change without actor: %', e; end if;
  end loop;
  if not exists(select 1 from public.platform_audit_events where action = 'club_permission_overrides.update' and details#>>'{old,allowed}' = 'false' and details#>>'{new,allowed}' = 'true'
    and details#>>'{new,user_id}' = '00000000-0000-4000-8000-000000000b02') then raise exception 'Override change not described'; end if;
  begin truncate public.club_permission_overrides; raise exception 'Overrides truncated'; exception when insufficient_privilege then null; end;
  begin truncate public.auth_role_cap_blocks; raise exception 'Caps truncated'; exception when insufficient_privilege then null; end;
  perform pg_temp.check_explain('after audit steps');
end $$;

-- 7. The settings reader returns plain-language data for the screen and only club-scope permissions.
do $$ declare s jsonb; begin
  perform pg_temp.as_super(); s := public.platform_permission_settings('00000000-0000-4000-8000-000000000b10');
  if exists(select 1 from jsonb_array_elements(s->'permissions') p where p->>'key' like 'platform.%') then raise exception 'Platform permission offered as club setting'; end if;
  if (select array_agg(value->>'key') from jsonb_array_elements(s->'roles')) <> array['owner','admin'] then raise exception 'Roles wrong: %', s->'roles'; end if;
  if not s->'club_defaults' @> '[{"role":"admin","permission":"club.rename","allowed":true}]' or not s->'cap_blocks' @> '[{"role":"owner","permission":"imports.delete"}]' then raise exception 'Settings incomplete: %', s; end if;
  if s->'defaults' @> '[{"role":"owner","permission":"imports.delete"}]' then raise exception 'Removed default still listed'; end if;
end $$;
select set_config('request.jwt.claims','',true), set_config('request.jwt.claim.sub','',true);

select 'permission_layers: equivalence without layers, layer order, caps, non-delegable safety, Super Admin only, audit, explanation equals can() passed' as result;
