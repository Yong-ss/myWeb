-- Phase 2: the caller's account context without a fixed club, so sign-in and identity no longer depend on CLUB_ID.
-- Read-only and additive: no table, policy, role or data changes; club_my_access(p_club) stays the per-club check.
-- Identity comes only from auth.uid(); there is no parameter, so no caller can ask about anyone else.
-- Clubs are listed only from the caller's own active memberships, even for an active Super Admin: the platform
-- panel (platform.read, trusted MFA) is the only place that lists every club.
create function public.club_my_context() returns jsonb language sql stable security definer set search_path = '' as $$
  with confirmed as (
    select u.id from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  ), mine as (
    select c.id, c.name, jsonb_agg(m.role order by m.role) as roles
    from confirmed me
    join public.club_memberships m on m.user_id = me.id and m.status = 'active'
    join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
    join public.club_clubs c on c.id = m.club_id
    group by c.id, c.name
  )
  select jsonb_build_object(
    'super_admin', exists(select 1 from confirmed me join public.platform_super_admins s on s.user_id = me.id),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2',
    'super_admin_active', exists(select 1 from confirmed) and club_private.super_admin_active(),
    'platform_permissions', coalesce((select jsonb_agg(key order by key) from public.auth_permissions
      where exists(select 1 from confirmed) and 'platform' = any(allowed_scopes) and club_private.can_platform(key)), '[]'::jsonb),
    -- A club is listed only while its roles still grant at least one permission (can() is the authority).
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'roles', x.roles) order by x.name, x.id)
      from mine x where cardinality(public.club_my_permissions(x.id)) > 0), '[]'::jsonb));
$$;
revoke all on function public.club_my_context() from public, anon;
grant execute on function public.club_my_context() to authenticated;
