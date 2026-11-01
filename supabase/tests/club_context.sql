-- Disposable PostgreSQL only. club_my_context(): the caller's own identity, platform state and clubs, nothing more.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.users(id,email,email_confirmed_at) values
 (md5('ctx-b-only')::uuid,'ctx-b@fixture.invalid',now()),(md5('ctx-both')::uuid,'ctx-both@fixture.invalid',now()),
 (md5('ctx-none')::uuid,'ctx-none@fixture.invalid',now()),(md5('ctx-unconfirmed')::uuid,'ctx-u@fixture.invalid',null),
 (md5('ctx-sa')::uuid,'ctx-sa@fixture.invalid',now());
insert into public.club_clubs(id,name) values(md5('ctx-a')::uuid,'Context A'),(md5('ctx-b')::uuid,'Context B'),(md5('ctx-c')::uuid,'Context C');
insert into public.club_memberships(club_id,user_id,role) values
 (md5('ctx-b')::uuid,md5('ctx-b-only')::uuid,'admin'),
 (md5('ctx-a')::uuid,md5('ctx-both')::uuid,'owner'),(md5('ctx-b')::uuid,md5('ctx-both')::uuid,'admin'),
 (md5('ctx-b')::uuid,md5('ctx-unconfirmed')::uuid,'owner');
insert into public.platform_super_admins(user_id) values(md5('ctx-sa')::uuid),(md5('ctx-unconfirmed')::uuid);
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values(md5('ctx-factor')::uuid,md5('ctx-sa')::uuid,'ctx','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values(md5('ctx-session')::uuid,md5('ctx-sa')::uuid,'aal2',md5('ctx-factor')::uuid);

create function pg_temp.ctx(u text,aal text default 'aal1') returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claim.sub',md5(u)::uuid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',md5(u)::uuid::text,'aal',aal,'session_id',md5('ctx-session')::uuid::text)::text,true);
 execute 'set local role authenticated';
 select public.club_my_context() into result;
 execute 'reset role';
 return result;
end $$;
create function pg_temp.club_ids(c jsonb) returns uuid[] language sql as $$ select coalesce(array_agg((x->>'id')::uuid order by x->>'name'),'{}') from jsonb_array_elements(c->'clubs') x $$;

do $$
declare c jsonb;
begin
 -- Only signed-in clients can call it; the API keys alone cannot.
 if has_function_privilege('anon','public.club_my_context()','EXECUTE') or has_function_privilege('public','public.club_my_context()','EXECUTE') then raise exception 'club_my_context callable without sign-in'; end if;
 if not has_function_privilege('authenticated','public.club_my_context()','EXECUTE') then raise exception 'club_my_context not callable by signed-in users'; end if;
 if (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid='public.club_my_context()'::regprocedure) is not true then raise exception 'club_my_context must be definer with empty search_path'; end if;
 if (select pronargs from pg_proc where oid='public.club_my_context()'::regprocedure)<>0 then raise exception 'club_my_context must not accept a user'; end if;

 -- Only club B: listed with its role, and no other club appears.
 c:=pg_temp.ctx('ctx-b-only');
 if pg_temp.club_ids(c)<>array[md5('ctx-b')::uuid] or c->'clubs'->0->'roles'<>'["admin"]' then raise exception 'B-only context wrong: %',c; end if;
 if (c->>'super_admin')::boolean or (c->>'super_admin_active')::boolean or c->'platform_permissions'<>'[]' then raise exception 'Ordinary user got platform state: %',c; end if;
 -- Different roles in A and B: both listed, each with its own roles; club C (no membership) never appears.
 c:=pg_temp.ctx('ctx-both');
 if pg_temp.club_ids(c)<>array[md5('ctx-a')::uuid,md5('ctx-b')::uuid] then raise exception 'A+B context wrong: %',c; end if;
 if (select x->'roles' from jsonb_array_elements(c->'clubs') x where x->>'name'='Context A')<>'["owner"]' then raise exception 'Roles mixed across clubs: %',c; end if;
 -- Revocation takes effect immediately.
 update public.club_memberships set status='revoked' where club_id=md5('ctx-b')::uuid and user_id=md5('ctx-both')::uuid;
 if pg_temp.club_ids(pg_temp.ctx('ctx-both'))<>array[md5('ctx-a')::uuid] then raise exception 'Revoked role still listed'; end if;
 -- No role, unconfirmed email: nothing.
 if pg_temp.ctx('ctx-none')<>'{"clubs":[],"super_admin":false,"session_aal2":false,"super_admin_active":false,"platform_permissions":[]}' then raise exception 'No-role context leaks: %',pg_temp.ctx('ctx-none'); end if;
 c:=pg_temp.ctx('ctx-unconfirmed');
 if c->'clubs'<>'[]' or (c->>'super_admin')::boolean then raise exception 'Unconfirmed email gets clubs or Super Admin identity: %',c; end if;

 -- Super Admin without membership: identity only before trusted MFA, and never a list of other clubs.
 c:=pg_temp.ctx('ctx-sa');
 if not (c->>'super_admin')::boolean or (c->>'super_admin_active')::boolean or c->'platform_permissions'<>'[]' or c->'clubs'<>'[]' then raise exception 'aal1 Super Admin context wrong: %',c; end if;
 c:=pg_temp.ctx('ctx-sa','aal2');
 if not (c->>'session_aal2')::boolean or (c->>'super_admin_active')::boolean or c->'platform_permissions'<>'[]' then raise exception 'Untrusted factor activated Super Admin: %',c; end if;
 perform club_private.trust_super_admin_factor(md5('ctx-factor')::uuid);
 c:=pg_temp.ctx('ctx-sa','aal2');
 if not (c->>'super_admin_active')::boolean or not (c->'platform_permissions' ? 'platform.read') then raise exception 'Trusted aal2 Super Admin not active: %',c; end if;
 if c->'clubs'<>'[]' then raise exception 'Active Super Admin context lists clubs without membership: %',c; end if;
 -- A forged aal claim without the matching Auth session stays inactive.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',md5('ctx-sa')::uuid::text,'aal','aal2','session_id',gen_random_uuid()::text)::text,true);
 set local role authenticated;
 if (public.club_my_context()->>'super_admin_active')::boolean then raise exception 'Forged session activated Super Admin'; end if;
 reset role;
end $$;
select 'club_context: own clubs only, roles per club, revocation, unconfirmed and no-role empty, MFA-gated Super Admin state, no other users, signed-in callers only passed' as result;
