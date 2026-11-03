-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
-- P3: platform readers are for the active Super Admin only (aal2 session from a confirmed device), they return only
-- whitelisted identity fields, effective permissions match can(), and every platform change lands in an append-only log.
-- d0dd... is the Super Admin and owner of ce0c...; 0c01 owns club X (0c10), 0c02 is admin of X, 0c03 has no club.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values
 ('00000000-0000-4000-8000-00000000f001','d0ddb226-a10a-471c-be4b-d5e5153bd313','fixture','totp','verified'),
 ('00000000-0000-4000-8000-00000000f002','d0ddb226-a10a-471c-be4b-d5e5153bd313','unconfirmed','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('00000000-0000-4000-8000-00000000c001','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f001'),
 ('00000000-0000-4000-8000-00000000c002','d0ddb226-a10a-471c-be4b-d5e5153bd313','aal2','00000000-0000-4000-8000-00000000f002'),
 ('00000000-0000-4000-8000-00000000c003','00000000-0000-4000-8000-000000000c01','aal2',null);
select club_private.trust_super_admin_factor('00000000-0000-4000-8000-00000000f001');
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000c01','x-owner@platform.test',now()),
 ('00000000-0000-4000-8000-000000000c02','x-admin@platform.test',now()),
 ('00000000-0000-4000-8000-000000000c03','loner@platform.test',null);
-- 60 more users so the user list must page.
insert into auth.users(id,email,email_confirmed_at) select md5('pu'||n)::uuid, format('bulk%s@platform.test', lpad(n::text,2,'0')), now() from generate_series(1,60) n;
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-000000000c10','Platform X');
insert into public.club_memberships(club_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000c10','00000000-0000-4000-8000-000000000c01','owner'),
 ('00000000-0000-4000-8000-000000000c10','00000000-0000-4000-8000-000000000c02','admin');
insert into public.club_players(id,club_id,display_name) values ('00000000-0000-4000-8000-000000000c20','00000000-0000-4000-8000-000000000c10','X player');

-- Nobody but the active Super Admin can call any reader: club owners and admins, aal2 without a Super Admin listing,
-- the Super Admin at aal1 or on an unconfirmed device. Every public platform_* function must carry the same gate.
set local role authenticated;
do $$
declare who record; f text;
begin
  for who in select * from (values
    ('00000000-0000-4000-8000-000000000c01','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c003"}','club owner at aal2'),
    ('00000000-0000-4000-8000-000000000c02','{}','club admin'),
    ('00000000-0000-4000-8000-000000000c03','{}','unconfirmed user'),
    ('d0ddb226-a10a-471c-be4b-d5e5153bd313','{"aal":"aal1"}','Super Admin at aal1'),
    ('d0ddb226-a10a-471c-be4b-d5e5153bd313','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c002"}','Super Admin on an unconfirmed device')) v(id,claims,label) loop
    perform set_config('request.jwt.claim.sub',who.id,true);
    perform set_config('request.jwt.claims',who.claims,true);
    if public.club_my_access('00000000-0000-4000-8000-000000000c10')->'platform_permissions' <> '[]' then raise exception 'Platform permission for %', who.label; end if;
    foreach f in array array['select public.platform_overview()','select public.platform_users()','select public.platform_roles()','select public.platform_activity()','select public.platform_role_context(null)','select public.platform_assign_role(null,null,null,null,null,null)'] loop
      begin execute f; raise exception '% ran %', who.label, f; exception when insufficient_privilege then null; end;
    end loop;
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'platform\_%' loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE') then raise exception 'API key can call %', f; end if;
    if (select prosrc from pg_proc where oid=f::regprocedure) !~ (case when f ~ '(^|\.)platform_(role_context|assign_role|transfer_owner|remove_from_club)\(' then 'if not club_private\.can_platform\(''platform\.roles\.assign''\) then raise exception'
      when f ~ '(^|\.)platform_set_admin_limit\(' then 'if not club_private\.can_platform\(''platform\.clubs\.admin_limit''\) then raise exception'
      when f ~ '(^|\.)platform_set_(role|personal)_permission\(' then 'if not club_private\.can_platform\(''platform\.permissions\.manage''\) then raise exception'
      when f ~ '(^|\.)platform_set_platform_admin\(' then 'if not club_private\.can_platform\(''platform\.platform_admins\.assign''\) then raise exception'
      when f ~ '(^|\.)platform_(save_alliance|set_club_alliance)\(' then 'if not club_private\.can_platform\(''platform\.alliances\.manage''\) then raise exception'
      when f ~ '(^|\.)platform_set_alliance_leader\(' then 'if not club_private\.can_platform\(''platform\.alliance_leaders\.assign''\) then raise exception'
      when f ~ '(^|\.)platform_remove_from_all_clubs\(' then 'if not club_private\.can_platform\(''platform\.users\.remove_all_clubs''\) then raise exception' else 'if not club_private\.can_platform\(''platform\.read''\) then raise exception' end) then raise exception '% lacks the platform gate', f; end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'platform\_%') <> 19 then raise exception 'Platform reader set changed; add it to these checks'; end if;
  if has_function_privilege('authenticated','club_private.can_platform(text)','EXECUTE') then raise exception 'can_platform callable by clients'; end if;
end $$;

-- The active Super Admin: real counts, whitelisted fields, effective permissions equal can(), full registry.
set local role authenticated;
do $$
declare o jsonb; page jsonb; u jsonb; e jsonb; r jsonb; seen int := 0; n int;
begin
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  -- Like can() for clubs: the active Super Admin holds every permission registered for the platform scope.
  if public.club_my_access('ce0c7103-1cdf-4b08-8619-f71d4915f598')->'platform_permissions' <> '["audit.actor_email.read","audit.read","members.read","platform.alliance_leaders.assign","platform.alliances.manage","platform.clubs.admin_limit","platform.permissions.manage","platform.platform_admins.assign","platform.read","platform.roles.assign","platform.users.remove_all_clubs"]'
    then raise exception 'Active Super Admin platform permissions wrong'; end if;
  -- platform.read is platform-scoped: it never becomes a club permission, so no club role can ever hold it.
  if 'platform.read' = any(public.club_my_permissions('ce0c7103-1cdf-4b08-8619-f71d4915f598')) then raise exception 'Platform permission leaked into club scope'; end if;
  o := public.platform_overview();
  if (o#>>'{totals,clubs}')::int <> 2 or (o#>>'{totals,users}')::int <> 64 or (o#>>'{totals,confirmed_users}')::int <> 63
    or (o#>>'{totals,members}')::int <> 3 or o->'alliances' <> '0'::jsonb then raise exception 'Overview totals wrong: %', o->'totals'; end if;
  if (select value from jsonb_array_elements(o->'clubs') where value->>'name'='Platform X') - 'id' - 'created_at' <> '{"name":"Platform X","members":2,"admins":1,"admin_limit":5,"players":1,"latest_snapshot":null,"is_complete_roster":null,"player_counts":null}' then raise exception 'Club row wrong: %', o->'clubs'; end if;
  -- Pages of 50 cover every user exactly once, in email order.
  page := public.platform_users();
  loop
    n := jsonb_array_length(page->'users'); seen := seen + n;
    for u in select value from jsonb_array_elements(page->'users') loop
      if (select array_agg(k order by k) from jsonb_object_keys(u) k) <> array['alliance','created_at','effective','email','email_confirmed','id','last_sign_in_at','memberships','platform_admin','super_admin'] then raise exception 'Unexpected user fields: %', u; end if;
    end loop;
    exit when page->'next' = 'null'::jsonb;
    if n <> 50 then raise exception 'Short page before the end'; end if;
    page := public.platform_users(null, page#>>'{next,key}', (page#>>'{next,id}')::uuid);
  end loop;
  if seen <> 64 then raise exception 'Paging saw % users', seen; end if;
  -- Search by email part or exact ID; the unconfirmed user holds no effective permission.
  u := public.platform_users('X-ADMIN@')->'users'->0;
  if u->>'email' <> 'x-admin@platform.test' or u->'memberships'->0->>'role_name' <> '管理员' or u->'memberships'->0->>'club_name' <> 'Platform X' then raise exception 'Search wrong: %', u; end if;
  if jsonb_array_length(public.platform_users('00000000-0000-4000-8000-000000000c03')->'users') <> 1 then raise exception 'ID search failed'; end if;
  if public.platform_users('loner')->'users'->0->'effective' <> '[]' then raise exception 'Unconfirmed user has effective permissions'; end if;
  if not (public.platform_users('owner@club.test')->'users'->0->>'super_admin')::boolean then raise exception 'Super Admin not flagged'; end if;
  begin perform public.platform_users(repeat('a',101)); raise exception 'Long query accepted'; exception when sqlstate '22023' then null; end;
  r := public.platform_roles();
  -- Clients cannot read the registry, so compare with what the migrations register: 20 permissions, the 4 system roles.
  if jsonb_array_length(r->'permissions') <> 20 or (select array_agg(value->>'key' order by value->>'key') from jsonb_array_elements(r->'roles')) <> array['admin','alliance_leader','owner','platform_admin'] then raise exception 'Registry incomplete: %', r; end if;
  if (select value->'permissions' from jsonb_array_elements(r->'roles') where value->>'key'='admin') ? 'club.rename' then raise exception 'Role matrix wrong'; end if;
  if (select (value->>'assigned')::int from jsonb_array_elements(r->'roles') where value->>'key'='owner') <> 2 then raise exception 'Owner assignment count wrong'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;

-- What the panel shows as a user's effective permissions is exactly what can() grants that user in each club.
do $$
declare person record; shown jsonb; real text[];
begin
  for person in select * from (values ('00000000-0000-4000-8000-000000000c01'::uuid,'x-owner@platform.test'),('00000000-0000-4000-8000-000000000c02','x-admin@platform.test')) v(id,email) loop
    perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
    perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
    shown := public.platform_users(person.email)->'users'->0->'effective'->0->'permissions';
    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub',person.id::text,true);
    real := public.club_my_permissions('00000000-0000-4000-8000-000000000c10');
    if shown <> to_jsonb(real) then raise exception 'Shown % but can() grants % for %', shown, real, person.email; end if;
  end loop;
end $$;
reset role;

-- Platform audit: every registry/role/Super Admin/device change is logged with actor and database login; rows are immutable.
do $$
declare before_count int := (select count(*) from public.platform_audit_events);
begin
  perform set_config('request.jwt.claim.sub','',true);
  update public.club_memberships set status='revoked' where user_id='00000000-0000-4000-8000-000000000c02';
  insert into public.auth_roles(key,scope_kind,club_id,name) values ('x_viewer','club','00000000-0000-4000-8000-000000000c10','X 查看');
  insert into public.auth_role_permissions values ('x_viewer','members.read');
  if (select count(*) from public.platform_audit_events) - before_count <> 3 then raise exception 'Platform changes not all logged'; end if;
  if not exists(select 1 from public.platform_audit_events where action='club_memberships.update' and details#>>'{old,status}'='active' and details#>>'{new,status}'='revoked'
    and actor_id is null and via=session_user) then raise exception 'Membership change not recorded with old/new and login'; end if;
  if not exists(select 1 from public.platform_audit_events where action='platform_super_admin_factors.insert' and details#>>'{new,factor_name}'='fixture') then raise exception 'Device confirmation not logged'; end if;
  -- The registration of platform.read itself is part of the record.
  if not exists(select 1 from public.platform_audit_events where action='auth_permissions.insert' and details#>>'{new,key}'='platform.read') then raise exception 'Migration change not logged'; end if;
  begin update public.platform_audit_events set action='x'; raise exception 'Platform audit updated'; exception when insufficient_privilege then null; end;
  begin delete from public.platform_audit_events; raise exception 'Platform audit deleted'; exception when insufficient_privilege then null; end;
  begin truncate public.platform_audit_events; raise exception 'Platform audit truncated'; exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.platform_audit_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('anon','public.platform_audit_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.platform_audit_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Platform audit reachable by an API role'; end if;
  if has_function_privilege('authenticated','club_private.platform_audit_row()','EXECUTE') then raise exception 'Audit trigger callable'; end if;
  -- Only explicitly listed columns are logged: a column added later (here a pretend secret) never reaches the log.
  alter table public.club_memberships add column fixture_secret text;
  update public.club_memberships set status='active', fixture_secret='should-never-be-logged' where user_id='00000000-0000-4000-8000-000000000c02';
  if exists(select 1 from public.platform_audit_events where details::text like '%should-never-be-logged%' or details::text like '%fixture_secret%') then raise exception 'Unlisted column logged'; end if;
  if not exists(select 1 from public.platform_audit_events where action='club_memberships.update' and details#>>'{new,status}'='active') then raise exception 'Listed columns no longer logged'; end if;
  alter table public.club_memberships drop column fixture_secret;
  -- Every audited table passes an explicit column list, and no listed column looks like a secret.
  if exists(select 1 from pg_trigger where tgfoid='club_private.platform_audit_row()'::regprocedure and tgnargs=0) then raise exception 'Audit trigger without a column list'; end if;
  if exists(select 1 from pg_trigger t, unnest(string_to_array(rtrim(encode(t.tgargs,'escape'),'\000'),'\000')) c
    where t.tgfoid='club_private.platform_audit_row()'::regprocedure and c ~* '(password|secret|token|code|key_hash|recovery)') then raise exception 'Secret-like column in an audit column list'; end if;
  -- Only the platform reader reads the log; any other function may only append to it.
  if exists(select 1 from pg_proc where prosrc ~ 'platform_audit_events' and proname not in ('platform_activity','platform_audit_row')
    and regexp_replace(prosrc,'insert into public\.platform_audit_events','', 'g') ~ 'platform_audit_events') then raise exception 'Another function reads the platform log'; end if;
end $$;
set local role authenticated;
do $$ declare a jsonb; e jsonb; begin
  -- Clients cannot write to the log directly.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
  begin insert into public.platform_audit_events(action) values ('forged'); raise exception 'Client wrote platform audit'; exception when insufficient_privilege then null; end;
  -- The reader resolves the affected user and club, and pages with a stable cursor.
  perform set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"00000000-0000-4000-8000-00000000c001"}',true);
  a := public.platform_activity();
  e := (select value from jsonb_array_elements(a->'events') where value->>'action'='club_memberships.update' and value#>>'{details,new,status}'='revoked');
  if e->>'subject' <> 'x-admin@platform.test' or e->>'club' <> 'Platform X' or e->'actor' <> 'null'::jsonb or e->>'via' is null then raise exception 'Activity row wrong: %', e; end if;
  if jsonb_array_length(a->'events') > 50 then raise exception 'Activity page unbounded'; end if;
  perform set_config('request.jwt.claims','{}',true);
end $$;
reset role;
select 'platform_admin: Super Admin-only readers, whitelisted fields, effective permissions equal can(), paging, append-only platform audit passed' as result;
