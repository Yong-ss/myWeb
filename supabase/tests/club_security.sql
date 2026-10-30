-- Run only through pnpm test:db on disposable PostgreSQL, never a linked project.
do $$ begin if current_database() <> 'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-000000000001','RLS fixture');
insert into public.club_players(id,club_id,display_name) values
 ('00000000-0000-4000-8000-000000000002','ce0c7103-1cdf-4b08-8619-f71d4915f598','same name'),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','same name');
insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values
 ('00000000-0000-4000-8000-000000000004','ce0c7103-1cdf-4b08-8619-f71d4915f598','d0ddb226-a10a-471c-be4b-d5e5153bd313','{}',1,'00000000-0000-4000-8000-000000000004'),
 ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','d0ddb226-a10a-471c-be4b-d5e5153bd313','{}',1,'00000000-0000-4000-8000-000000000005');
insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id) values
 ('00000000-0000-4000-8000-000000000006','ce0c7103-1cdf-4b08-8619-f71d4915f598','2026-10-27',1,'00000000-0000-4000-8000-000000000004'),
 ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','2026-10-27',1,'00000000-0000-4000-8000-000000000005');
insert into public.club_snapshot_players(club_id,snapshot_id,player_id) values
 ('ce0c7103-1cdf-4b08-8619-f71d4915f598','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003');
insert into public.club_audit_events(club_id,actor_id,action) values
 ('00000000-0000-4000-8000-000000000001','d0ddb226-a10a-471c-be4b-d5e5153bd313','rls_fixture');

do $$ begin
  begin
    insert into public.club_snapshot_players(club_id,snapshot_id,player_id) values
    ('ce0c7103-1cdf-4b08-8619-f71d4915f598','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000003');
    raise exception 'Cross-club player relation accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.club_memberships set role = 'super_admin' where user_id = 'd0ddb226-a10a-471c-be4b-d5e5153bd313';
    raise exception 'Global role accepted as club role';
  exception when check_violation then null; end;
  begin
    update public.club_snapshot_players set extraordinary_score = -1;
    raise exception 'Negative score accepted';
  exception when check_violation then null; end;
  begin
    update public.club_snapshots set supersedes_id = id;
    raise exception 'Self supersession accepted';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d0ddb226-a10a-471c-be4b-d5e5153bd313',true);
do $$
declare t text; n integer;
begin
  if (select count(*) from public.club_memberships) <> 1 then raise exception 'Owner cannot read own membership'; end if;
  foreach t in array array['club_clubs','club_players','club_imports','club_snapshots','club_snapshot_players'] loop
    execute format('select count(*) from public.%I where %I = $1', t, case when t='club_clubs' then 'id' else 'club_id' end)
      into n using '00000000-0000-4000-8000-000000000001'::uuid;
    if n <> 0 then raise exception 'Cross-club read: %',t; end if;
    execute format('select count(*) from public.%I',t) into n;
    if n = 0 then raise exception 'Own-club data inaccessible: %',t; end if;
  end loop;
  foreach t in array array['club_clubs','club_memberships','club_players','club_imports','club_snapshots','club_snapshot_players','club_audit_events'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') then
      raise exception 'Unexpected application write grant: %', t;
    end if;
    begin
      execute format('delete from public.%I',t);
      raise exception 'Client deletion allowed: %',t;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;

-- Admin has read access, but cannot appoint/revoke an owner or administrator.
reset role;
update public.club_memberships set role='admin' where user_id='d0ddb226-a10a-471c-be4b-d5e5153bd313';
set local role authenticated;
do $$ begin
  if (select count(*) from public.club_players) <> 1 then raise exception 'Admin isolation failed'; end if;
  begin
    update public.club_memberships set role='owner';
    raise exception 'Admin escalation allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- Revocation takes effect even if the JWT has not expired.
reset role;
update public.club_memberships set status='revoked' where user_id='d0ddb226-a10a-471c-be4b-d5e5153bd313';
set local role authenticated;
do $$
declare t text; n integer;
begin
  foreach t in array array['club_clubs','club_memberships','club_players','club_imports','club_snapshots','club_snapshot_players'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n <> 0 then raise exception 'Revoked membership still reads: %',t; end if;
  end loop;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin
  if exists(select 1 from public.club_clubs) then raise exception 'Unrelated account sees clubs'; end if;
end $$;
reset role;
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['club_clubs','club_memberships','club_players','club_imports','club_snapshots','club_snapshot_players','club_audit_events'] loop
    begin
      execute format('select * from public.%I',t);
      raise exception 'Anonymous read allowed: %',t;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
select 'club_security: tenant isolation, role isolation, revocation, no client writes, anonymous denial and constraints passed' as result;
