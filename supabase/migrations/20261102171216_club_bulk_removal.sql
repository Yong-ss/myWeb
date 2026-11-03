-- Permissions V1 stage G: removal from every club (Super Admin only) and what the final admin screens need to explain
-- access. Additive: no existing signature changes; the deployed Worker keeps working.

-- 1. Registry. Super Admin only, like the admin limit: one confirmed action touching many clubs.
insert into public.auth_permissions(key, kind, allowed_scopes, read_only, sensitive, super_admin_only, description) values
  ('platform.users.remove_all_clubs', 'action', '{platform}', false, true, true, '把一个账户移出全部俱乐部');

-- 2. Remove one account from every club in one transaction. Only club roles change (status 'revoked'): the account,
-- its platform and alliance identities, personal settings, history and audit stay. All or nothing: refused while the
-- account is any club's owner (transfer first, so no normal club is left without an owner), or when any of its clubs
-- changed since the preview (p_expected = {club_id: role_version} of exactly the clubs it holds a role in).
create function public.platform_remove_from_all_clubs(p_user uuid, p_expected jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); saved club_private.role_requests%rowtype; c record; held jsonb := '{}'::jsonb; owners text; locked uuid[] := '{}'; more uuid[]; one uuid;
  payload jsonb := jsonb_build_object('remove_all', p_user, 'expected', p_expected); response jsonb; n integer;
begin
  if not club_private.can_platform('platform.users.remove_all_clubs') then raise exception using errcode = '42501', message = '只有超级管理员可以把账户移出全部俱乐部'; end if;
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以把账户移出全部俱乐部'; end if;
  if p_user is null or p_request is null or p_expected is null or jsonb_typeof(p_expected) <> 'object' then raise exception using errcode = '22023', message = '移出参数无效'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_request::text, 1));
  select * into saved from club_private.role_requests where actor_id = actor and request_id = p_request;
  if found then
    if saved.payload <> payload then raise exception using errcode = 'PT409', message = '提交编号已用于其他角色操作'; end if;
    return saved.result;
  end if;
  if not exists(select 1 from auth.users where id = p_user) then raise exception using errcode = '22023', message = '目标账户不存在'; end if;
  -- The same club locks as every role change and business writer. A role granted in another club while we lock is seen
  -- on the next pass and locked too, so every club this account holds a role in is locked before anything is checked;
  -- after that no role in those clubs can change under us (change_role takes the same club lock).
  loop
    more := array(select distinct m.club_id from public.club_memberships m where m.user_id = p_user and m.status = 'active' and m.club_id <> all(locked) order by m.club_id);
    exit when cardinality(more) = 0;
    foreach one in array more loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(one::text, 0)); end loop;
    locked := locked || more;
  end loop;
  -- Rechecked after the locks: device or session revocation while waiting stops the change.
  if not club_private.super_admin_active() then raise exception using errcode = '42501', message = '只有超级管理员可以把账户移出全部俱乐部'; end if;
  for c in select m.club_id, m.role, x.name, x.role_version from public.club_memberships m join public.club_clubs x on x.id = m.club_id
      where m.user_id = p_user and m.status = 'active' and m.club_id = any(locked) order by m.club_id for update of x loop
    held := held || jsonb_build_object(c.club_id::text, c.role_version);
    if c.role = 'owner' then owners := concat_ws('、', owners, c.name); end if;
  end loop;
  if owners is not null then
    raise exception using errcode = 'PT409', message = format('该账户是以下俱乐部的公会长：%s。请先转让公会长，再移出全部俱乐部；本次没有移出任何俱乐部。', owners);
  end if;
  if held <> p_expected then raise exception using errcode = 'PT409', message = '职位已变化，请刷新后重新核对；本次没有移出任何俱乐部。'; end if;
  -- Only the locked, checked clubs and never an owner role: a role granted in some other club after the check (its own
  -- lock, not ours) is a new decision the preview never showed, so it stays. The membership triggers record each change
  -- in the platform log and bump each club's role version.
  with gone as (update public.club_memberships set status = 'revoked' where user_id = p_user and status = 'active' and club_id = any(locked) and role <> 'owner'
    returning club_id, role)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'role', g.role) order by x.name, x.id), '[]'::jsonb), count(*) into response, n
    from gone g join public.club_clubs x on x.id = g.club_id;
  response := jsonb_build_object('clubs', response);
  if n = 0 then
    insert into public.platform_audit_events(actor_id, action, details) values (actor, 'club_memberships.noop', jsonb_build_object('new', jsonb_build_object('user_id', p_user, 'status', null)));
  end if;
  response := response || jsonb_build_object('changed', n > 0);
  insert into club_private.role_requests(actor_id, request_id, payload, result) values (actor, p_request, payload, response);
  return response;
end $$;
revoke all on function public.platform_remove_from_all_clubs(uuid, jsonb, uuid) from public, anon, service_role;
grant execute on function public.platform_remove_from_all_clubs(uuid, jsonb, uuid) to authenticated;

-- 3. The user list names the alliance an account leads (and its clubs), so a leader without a club role can be found
-- and given a Super Admin forced deny in one of those clubs.
-- Same as 20261101235927 (comment below), plus `alliance`: the alliance this account leads and its clubs (stage G, so
-- the Super Admin can find leaders who have no club role). Original comment:
-- Same as 20261101195800, plus `platform_admin`; `super_admin` and membership `created_at` are present only for the
-- active Super Admin. A membership's created_at equals its audit event's time, so it would let a platform admin match a
-- Super Admin's masked log entries (see platform_activity) back to the account.
create or replace function public.platform_users(p_query text default null, p_after_key text default null, p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(nullif(btrim(coalesce(p_query, '')), '')); result jsonb; sees boolean := club_private.sees_super_admins();
begin
  if not club_private.can_platform('platform.read') then raise exception using errcode = '42501', message = '需要平台管理权限'; end if;
  if length(q) > 100 then raise exception using errcode = '22023', message = '搜索内容过长'; end if;
  with matched as (
    select u.id, u.email, u.email_confirmed_at, u.created_at, u.last_sign_in_at, lower(coalesce(u.email, '')) as k from auth.users u
    where (q is null or u.id::text = q or strpos(lower(coalesce(u.email, '')), q) > 0)
      and (p_after_id is null or (lower(coalesce(u.email, '')), u.id) > (p_after_key, p_after_id))
    order by 6, 1 limit 51
  ), visible as (select * from matched order by k, id limit 50)
  select jsonb_build_object('users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'email', v.email, 'email_confirmed', v.email_confirmed_at is not null, 'created_at', v.created_at, 'last_sign_in_at', v.last_sign_in_at,
      'super_admin', exists(select 1 from public.platform_super_admins s where s.user_id = v.id),
      'platform_admin', exists(select 1 from public.platform_role_assignments a where a.user_id = v.id and a.role = 'platform_admin' and a.status = 'active'),
      'alliance', (select jsonb_build_object('id', a.id, 'name', a.name, 'clubs', coalesce((select jsonb_agg(jsonb_build_object('club_id', c.id, 'club_name', c.name) order by c.name, c.id)
          from public.club_alliance_members am join public.club_clubs c on c.id = am.club_id where am.alliance_id = a.id and am.status = 'active'), '[]'::jsonb))
        from public.alliance_leaders l join public.club_alliances a on a.id = l.alliance_id and a.status = 'active' where l.user_id = v.id and l.status = 'active'),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object('club_id', m.club_id, 'club_name', c.name, 'role', m.role, 'role_name', r.name, 'status', m.status, 'created_at', m.created_at)
          - case when sees then '' else 'created_at' end order by c.name, m.role)
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id left join public.auth_roles r on r.key = m.role where m.user_id = v.id), '[]'::jsonb),
      -- The same rule as club_private.can() for one user; supabase/tests/platform_admin.sql checks both agree.
      'effective', coalesce((select jsonb_agg(jsonb_build_object('club_id', e.club_id, 'club_name', e.club_name, 'permissions', to_jsonb(e.permissions)) order by e.club_name) from (
        select m.club_id, c.name as club_name, array_agg(distinct p.key order by p.key) as permissions
        from public.club_memberships m join public.club_clubs c on c.id = m.club_id
        join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
        join public.auth_permissions p on 'club' = any(p.allowed_scopes)
          and club_private.layer_allows(club_private.permission_layer(m.club_id, m.user_id, m.role, p.key))
        where m.user_id = v.id and m.status = 'active' and v.email_confirmed_at is not null
        group by m.club_id, c.name) e), '[]'::jsonb)
    ) - case when sees then '' else 'super_admin' end order by v.k, v.id) from visible v), '[]'::jsonb),
    'next', case when (select count(*) from matched) > 50 then (select jsonb_build_object('key', k, 'id', id) from visible order by k desc, id desc limit 1) end)
  into result;
  return result;
end $$;


-- 4. The explanation shows the alliance path too: `alliance_leader` (this account reads this club through the alliance
-- it leads), per permission `alliance` (that path grants it) and `allowed` as the final result of can() for them.
-- Same as 20261101205005 otherwise; the platform and owner readers both use it.
create or replace function club_private.permission_explain(p_club uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare held text; confirmed boolean; leads boolean;
begin
  if p_club is null or not exists(select 1 from public.club_clubs where id = p_club) then raise exception using errcode = '22023', message = '目标俱乐部不存在'; end if;
  select email_confirmed_at is not null into confirmed from auth.users where id = p_user;
  if not found then raise exception using errcode = '22023', message = '目标账户不存在'; end if;
  -- Stage G: whether this account reads the club through the alliance it leads (club_private.can_alliance_read for them).
  leads := exists(select 1 from public.alliance_leaders l join public.club_alliances a on a.id = l.alliance_id and a.status = 'active'
    join public.club_alliance_members am on am.alliance_id = a.id and am.club_id = p_club and am.status = 'active'
    where l.user_id = p_user and l.status = 'active');
  select m.role into held from public.club_memberships m
    join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
    where m.club_id = p_club and m.user_id = p_user and m.status = 'active';
  return jsonb_build_object('club_id', p_club, 'user_id', p_user, 'role', held, 'role_name', (select name from public.auth_roles where key = held),
    'email_confirmed', confirmed, 'super_admin', exists(select 1 from public.platform_super_admins where user_id = p_user), 'alliance_leader', leads,
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description, 'sensitive', p.sensitive, 'non_delegable', p.non_delegable,
        'layer', x.layer, 'allowed', confirmed and (club_private.layer_allows(x.layer) or (x.via_alliance and f.allowed is distinct from false)),
        'alliance', x.via_alliance,
        'platform_default', exists(select 1 from public.auth_role_permissions where role_key = held and permission_key = p.key),
        'cap_blocked', exists(select 1 from public.auth_role_cap_blocks where role_key = held and permission_key = p.key),
        'club_default', (select allowed from public.club_role_permissions where club_id = p_club and role_key = held and permission_key = p.key),
        'forced', f.allowed,
        'owner_set', (select allowed from public.club_permission_overrides where club_id = p_club and user_id = p_user and permission_key = p.key and set_by = 'owner')
      ) order by p.key)
      from public.auth_permissions p
      left join public.club_permission_overrides f on f.club_id = p_club and f.user_id = p_user and f.permission_key = p.key and f.set_by = 'super_admin'
      cross join lateral (select case when held is null then 'no_role' else club_private.permission_layer(p_club, p_user, held, p.key) end as layer,
        leads and p.read_only and 'alliance' = any(p.allowed_scopes) and exists(select 1 from public.auth_role_permissions rp where rp.role_key = 'alliance_leader' and rp.permission_key = p.key) as via_alliance) x
      where 'club' = any(p.allowed_scopes)), '[]'::jsonb));
end $$;

