-- Upgrade check, run by scripts/test-db.mjs in its own transaction: the part above the marker runs on the database
-- as it was before this migration, the part below after every migration. Synthetic local data only.
do $$ begin if current_database()<>'squirrelapi_test' then raise exception 'Isolated test database required'; end if; end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-0000000000d1','dual@upgrade.test',now()),
 ('00000000-0000-4000-8000-0000000000d2','admin@upgrade.test',now());
insert into public.club_clubs(id,name) values ('00000000-0000-4000-8000-0000000000da','Upgrade A'),('00000000-0000-4000-8000-0000000000db','Upgrade B');
-- d1: owner AND admin in A (allowed by D-036 union), admin in B. d2: plain admin in A plus an old revoked owner row.
insert into public.club_memberships(club_id,user_id,role,status) values
 ('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000d1','owner','active'),
 ('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000d1','admin','active'),
 ('00000000-0000-4000-8000-0000000000db','00000000-0000-4000-8000-0000000000d1','admin','active'),
 ('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000d2','admin','active'),
 ('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000d2','owner','revoked');
-- @migrate
do $$ declare a uuid:='00000000-0000-4000-8000-0000000000da'; b uuid:='00000000-0000-4000-8000-0000000000db';
 d1 uuid:='00000000-0000-4000-8000-0000000000d1'; d2 uuid:='00000000-0000-4000-8000-0000000000d2';
begin
  -- Owner kept, the extra admin role revoked (row kept as history), nothing else touched.
  if (select string_agg(role||':'||status,',' order by role) from public.club_memberships where club_id=a and user_id=d1)<>'admin:revoked,owner:active'
    or (select status from public.club_memberships where club_id=b and user_id=d1)<>'active'
    or (select string_agg(role||':'||status,',' order by role) from public.club_memberships where club_id=a and user_id=d2)<>'admin:active,owner:revoked'
  then raise exception 'Single-role data fix wrong'; end if;
  -- Exactly one audit entry for the fix, made by the migration (no app actor).
  if (select count(*) from public.platform_audit_events where action='club_memberships.update' and actor_id is null
      and details#>>'{new,user_id}'=d1::text and details#>>'{old,status}'='active' and details#>>'{new,status}'='revoked')<>1
  then raise exception 'Data fix not audited'; end if;
  -- Afterwards the rule holds for new rows too.
  begin insert into public.club_memberships(club_id,user_id,role) values (b,d2,'admin'),(b,d2,'owner');
    raise exception 'Second active role accepted after upgrade'; exception when unique_violation then null; end;
end $$;
