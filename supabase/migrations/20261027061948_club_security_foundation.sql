-- Stage A: no application writes. Stage B must add audited transaction functions.
create table public.club_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text, -- Game reporting timezone is not confirmed yet.
  created_at timestamptz not null default now()
);

create table public.club_memberships (
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create unique index club_one_active_owner on public.club_memberships(club_id) where role = 'owner' and status = 'active';
create index club_memberships_user on public.club_memberships(user_id, club_id) where status = 'active';

create table public.club_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  match_name text, -- Candidate matching only; deliberately not unique.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, id)
);
create index club_players_match on public.club_players(club_id, match_name);

create table public.club_imports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  raw_text text not null check (octet_length(raw_text) between 1 and 1048576),
  schema_version integer not null check (schema_version = 1),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (club_id, id),
  unique (club_id, request_id)
);
create index club_imports_actor on public.club_imports(submitted_by);

create table public.club_snapshots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  snapshot_date date not null,
  revision integer not null check (revision > 0),
  import_id uuid not null,
  is_complete_roster boolean not null default false,
  is_current boolean not null default true,
  supersedes_id uuid,
  created_at timestamptz not null default now(),
  unique (club_id, id),
  unique (club_id, snapshot_date, id),
  unique (club_id, snapshot_date, revision),
  unique (club_id, import_id),
  check (supersedes_id is null or supersedes_id <> id),
  check ((revision = 1 and supersedes_id is null) or (revision > 1 and supersedes_id is not null)),
  foreign key (club_id, import_id) references public.club_imports(club_id, id) on delete restrict,
  foreign key (club_id, snapshot_date, supersedes_id) references public.club_snapshots(club_id, snapshot_date, id) on delete restrict
);
create unique index club_snapshots_current on public.club_snapshots(club_id, snapshot_date) where is_current;
create index club_snapshots_previous on public.club_snapshots(club_id, snapshot_date, supersedes_id);

create table public.club_snapshot_players (
  club_id uuid not null,
  snapshot_id uuid not null,
  player_id uuid not null,
  name text check (name is null or length(btrim(name)) between 1 and 200),
  position text,
  level integer check (level >= 0),
  pathway text,
  extraordinary_score bigint check (extraordinary_score >= 0),
  prosperity bigint check (prosperity >= 0),
  weekly_activity bigint check (weekly_activity >= 0),
  group_name text,
  join_days integer check (join_days >= 0),
  primary key (club_id, snapshot_id, player_id),
  foreign key (club_id, snapshot_id) references public.club_snapshots(club_id, id) on delete restrict,
  foreign key (club_id, player_id) references public.club_players(club_id, id) on delete restrict
);
create index club_snapshot_players_player on public.club_snapshot_players(club_id, player_id, snapshot_id);

create table public.club_audit_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club_clubs(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (length(action) between 1 and 100),
  target_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index club_audit_events_club on public.club_audit_events(club_id, created_at);
create index club_audit_events_actor on public.club_audit_events(actor_id);

-- Only read your own active membership: no recursive policy or role escalation.
alter table public.club_memberships enable row level security;
create policy membership_read_self on public.club_memberships for select to authenticated
  using (user_id = (select auth.uid()) and status = 'active');

alter table public.club_clubs enable row level security;
create policy club_read_member on public.club_clubs for select to authenticated
  using (id in (select club_id from public.club_memberships where user_id = (select auth.uid()) and status = 'active'));

do $$
declare table_name text;
begin
  foreach table_name in array array['club_players', 'club_imports', 'club_snapshots', 'club_snapshot_players', 'club_audit_events'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy club_read_member on public.%I for select to authenticated using (club_id in (select club_id from public.club_memberships where user_id = (select auth.uid()) and status = ''active''))', table_name);
  end loop;
  foreach table_name in array array['club_clubs', 'club_memberships', 'club_players', 'club_imports', 'club_snapshots', 'club_snapshot_players', 'club_audit_events'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end $$;

-- Explicit bootstrap for the verified existing owner; never claim the first signup.
insert into public.club_clubs(id, name) values ('ce0c7103-1cdf-4b08-8619-f71d4915f598', '我的俱乐部');
insert into public.club_memberships(club_id, user_id, role)
  values ('ce0c7103-1cdf-4b08-8619-f71d4915f598', 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'owner');
insert into public.club_audit_events(club_id, actor_id, action, details)
  values ('ce0c7103-1cdf-4b08-8619-f71d4915f598', 'd0ddb226-a10a-471c-be4b-d5e5153bd313', 'club_initialized', '{"stage":"A"}');
