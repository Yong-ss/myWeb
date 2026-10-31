-- A minimal Auth interface for testing the actual migrations/RLS on PostgreSQL.
-- This is NOT a Supabase Auth server, and must never run against a linked project.
do $$ begin
  if current_database() <> 'squirrelapi_test' then raise exception 'Test database required'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
-- Same claim source as Supabase's auth.jwt(); tests set request.jwt.claims to simulate aal2.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
-- Minimal shape of the Auth tables Super Admin activation reads (real Supabase uses enums with the same labels).
create table auth.mfa_factors(id uuid primary key, user_id uuid not null, friendly_name text, factor_type text not null, status text not null, created_at timestamptz not null default now());
create table auth.sessions(id uuid primary key, user_id uuid not null, aal text, factor_id uuid, not_after timestamptz);
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;
insert into auth.users(id,email,email_confirmed_at) values ('d0ddb226-a10a-471c-be4b-d5e5153bd313','owner@club.test',now());
