-- Permissions V1 pre-launch fix (owner-approved rule, plan A, 2026-11-03): an owner grants admins only what the caller
-- holds AS this club's active owner (owner role layers), never through an alliance-leader read or any other identity.
-- Checked when the setting is written only; permission_layer() is unchanged, so a later Super Admin tightening of the
-- owner does not revoke earlier admin grants (the Super Admin uses the admin cap or a forced deny for that).
-- The active Super Admin keeps the previous behaviour on these writers. Additive: no signature changes.

-- Whether the caller is this club's active, confirmed owner and holds the permission through the owner role:
-- cap, Super Admin forced setting, club default, platform default (the owner branch of permission_layer).
-- Invoker; callable only inside the definer functions below.
create function club_private.caller_owner_holds(p_club uuid, p_permission text) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from public.club_memberships m
    join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
    where m.club_id = p_club and m.user_id = (select auth.uid()) and m.role = 'owner' and m.status = 'active'
      and club_private.layer_allows(club_private.permission_layer(p_club, m.user_id, 'owner', p_permission)));
$$;
revoke all on function club_private.caller_owner_holds(uuid, text) from public, anon, authenticated, service_role;

-- Owner writers (20261101205005): identical except the "never grant what you lack" check.
create or replace function public.club_set_admin_default(p_club uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; old boolean; n integer; platform boolean;
begin
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  perform club_private.require(p_club, 'club.admins.permissions');
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  select allowed into old from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p_permission;
  platform := exists(select 1 from public.auth_role_permissions where role_key = 'admin' and permission_key = p_permission);
  if (p_value is true or (p_value is null and platform and not coalesce(old, platform)))
    and not (club_private.super_admin_active() or club_private.caller_owner_holds(p_club, p_permission)) then
    raise exception using errcode = '42501', message = '不能授予你作为本俱乐部公会长没有的权限';
  end if;
  if p_value is null then delete from public.club_role_permissions where club_id = p_club and role_key = 'admin' and permission_key = p_permission;
  else insert into public.club_role_permissions(club_id, role_key, permission_key, allowed) values (p_club, 'admin', p_permission, p_value)
    on conflict (club_id, role_key, permission_key) do update set allowed = excluded.allowed where club_role_permissions.allowed is distinct from excluded.allowed; end if;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, auth.uid(), 'admin_default_changed', null,
      jsonb_build_object('permission', p_permission, 'description', perm.description, 'old', old, 'new', p_value));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;

create or replace function public.club_set_admin_permission(p_club uuid, p_user uuid, p_permission text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare perm public.auth_permissions%rowtype; old boolean; held text; n integer; was boolean;
begin
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  if p_user is null then raise exception using errcode = '22023', message = '目标账户无效'; end if;
  if p_user = (select auth.uid()) then raise exception using errcode = '42501', message = '不能修改自己的权限'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text, 0));
  perform club_private.require(p_club, 'club.admins.permissions');
  perm := club_private.owner_settable(p_club, p_permission, p_value);
  select role into held from public.club_memberships where club_id = p_club and user_id = p_user and status = 'active' for share;
  if held is distinct from 'admin' then raise exception using errcode = 'PT409', message = '只能为本俱乐部的有效管理员设置个人权限'; end if;
  select allowed into old from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'owner';
  was := club_private.layer_allows(club_private.permission_layer(p_club, p_user, 'admin', p_permission));
  if p_value is null then delete from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p_permission and set_by = 'owner';
  else insert into public.club_permission_overrides(club_id, user_id, permission_key, set_by, allowed) values (p_club, p_user, p_permission, 'owner', p_value)
    on conflict (club_id, user_id, permission_key, set_by) do update set allowed = excluded.allowed where club_permission_overrides.allowed is distinct from excluded.allowed; end if;
  get diagnostics n = row_count;
  if (p_value is true or (not was and club_private.layer_allows(club_private.permission_layer(p_club, p_user, 'admin', p_permission))))
    and not (club_private.super_admin_active() or club_private.caller_owner_holds(p_club, p_permission)) then
    raise exception using errcode = '42501', message = '不能授予你作为本俱乐部公会长没有的权限';
  end if;
  if n > 0 then
    insert into public.club_audit_events(club_id, actor_id, action, target_id, details) values (p_club, auth.uid(), 'admin_permission_changed', p_user,
      jsonb_build_object('permission', p_permission, 'description', perm.description, 'old', old, 'new', p_value));
  end if;
  return jsonb_build_object('changed', n > 0);
end $$;
