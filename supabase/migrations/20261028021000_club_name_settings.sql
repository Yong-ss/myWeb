-- Narrow owner-only write; ordinary table updates remain revoked.
create or replace function public.club_rename(p_club_id uuid, p_name text, p_expected text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); previous_name text; next_name text := btrim(p_name);
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='42501', message='请先登录已确认邮箱的账户';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text,0));
  if not exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=actor and status='active' and role='owner') then
    raise exception using errcode='42501', message='只有公会长可以修改俱乐部名称';
  end if;
  if next_name is null or length(next_name) not between 1 and 120 or next_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='名称需要 1～120 个字符，不能包含控制字符';
  end if;
  select name into previous_name from public.club_clubs where id=p_club_id for update;
  if not found then raise exception using errcode='42501', message='无权修改此俱乐部'; end if;
  if previous_name is distinct from p_expected then raise exception using errcode='PT409', message='名称已被修改，请刷新后重试'; end if;
  if previous_name is distinct from next_name then
    update public.club_clubs set name=next_name where id=p_club_id;
    insert into public.club_audit_events(club_id,actor_id,action,target_id,details)
      values(p_club_id,actor,'club_renamed',p_club_id,jsonb_build_object('old_name',previous_name,'new_name',next_name));
  end if;
  return jsonb_build_object('name',next_name);
end $$;
revoke all on function public.club_rename(uuid,text,text) from public, anon;
grant execute on function public.club_rename(uuid,text,text) to authenticated;
