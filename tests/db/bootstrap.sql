-- A minimal Auth interface for testing the actual migrations/RLS on PostgreSQL.
-- This is NOT a Supabase Auth server, and must never run against a linked project.
do $$ begin
  if current_database() <> 'squirrelapi_test' then raise exception 'Test database required'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users(id,email,email_confirmed_at) values ('d0ddb226-a10a-471c-be4b-d5e5153bd313','owner@club.test',now());
