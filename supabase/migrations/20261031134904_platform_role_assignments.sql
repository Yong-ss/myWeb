-- P4: existing verified accounts only; no registry editing or Super Admin identity assignment.
alter table public.club_clubs add column admin_limit integer not null default 5 check(admin_limit between 1 and 1000);
alter table public.club_clubs add column role_version bigint not null default 0 check(role_version>=0);
insert into public.auth_permissions(key,kind,allowed_scopes,read_only,sensitive,description)
values ('platform.roles.assign', 'action', '{platform}', false, true, '任命、撤销及转让俱乐部角色');

-- Also invalidate optimistic versions after SQL Editor changes. This trigger never changes memberships.
create function club_private.membership_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   update public.club_clubs set role_version=role_version+1 where id=new.club_id;
 elsif tg_op='DELETE' then
   update public.club_clubs set role_version=role_version+1 where id=old.club_id;
 elsif (new.club_id,new.user_id,new.role,new.status) is distinct from (old.club_id,old.user_id,old.role,old.status) then
   update public.club_clubs set role_version=role_version+1 where id in (old.club_id,new.club_id);
 end if;
 return null;
end $$;
revoke all on function club_private.membership_version() from public,anon,authenticated,service_role;
create trigger club_membership_version after insert or update or delete on public.club_memberships
for each row execute function club_private.membership_version();

create table club_private.role_requests(
 actor_id uuid not null, request_id uuid not null, payload jsonb not null, result jsonb not null,
 primary key(actor_id,request_id)
);
revoke all on club_private.role_requests from public,anon,authenticated,service_role;

create function public.platform_role_context(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not club_private.can_platform('platform.roles.assign') then raise exception using errcode='42501',message='需要超级管理员角色管理权限'; end if;
 if not club_private.super_admin_active() then raise exception using errcode='42501',message='需要已确认设备的两步验证会话'; end if;
 if not exists(select 1 from auth.users where id=p_user) then
   raise exception using errcode='22023',message='目标账户不存在';
 end if;
 return jsonb_build_object(
   'clubs',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'admin_limit',c.admin_limit,'role_version',c.role_version,
     'owner_id',(select user_id from public.club_memberships where club_id=c.id and role='owner' and status='active')) order by c.created_at,c.id) from public.club_clubs c),'[]'::jsonb),
   'memberships',coalesce((select jsonb_agg(jsonb_build_object('club_id',club_id,'role',role,'status',status) order by club_id,role) from public.club_memberships where user_id=p_user),'[]'::jsonb));
end $$;

create function public.platform_assign_role(p_club uuid,p_user uuid,p_role text,p_action text,p_expected bigint,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); club public.club_clubs%rowtype; saved club_private.role_requests%rowtype;
 payload jsonb:=jsonb_build_object('club',p_club,'user',p_user,'role',p_role,'action',p_action,'expected',p_expected);
 old_status text; owner_id uuid; changed boolean:=false; response jsonb;
begin
 if not club_private.can_platform('platform.roles.assign') then raise exception using errcode='42501',message='需要超级管理员角色管理权限'; end if;
 if not club_private.super_admin_active() then raise exception using errcode='42501',message='需要已确认设备的两步验证会话'; end if;
 if p_club is null or p_user is null or p_request is null or p_expected is null or p_expected<0 or p_role is null or p_role not in ('owner','admin')
   or p_action is null or p_action not in ('grant','revoke','transfer') or (p_action='transfer' and p_role<>'owner') then
   raise exception using errcode='22023',message='角色操作参数无效';
 end if;
 -- Request lock prevents cross-club reuse racing the same actor/request key; the club lock matches business writers.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request::text,1));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text,0));
 -- A queued request must observe device/session revocation that happened while waiting for either lock.
 if not club_private.can_platform('platform.roles.assign') then raise exception using errcode='42501',message='需要超级管理员角色管理权限'; end if;
 if not club_private.super_admin_active() then raise exception using errcode='42501',message='需要已确认设备的两步验证会话'; end if;
 select * into saved from club_private.role_requests where actor_id=actor and request_id=p_request;
 if found then
   if saved.payload<>payload then raise exception using errcode='PT409',message='提交编号已用于其他角色操作'; end if;
   return saved.result;
 end if;
 select * into club from public.club_clubs where id=p_club for update;
 if not found then raise exception using errcode='22023',message='目标俱乐部不存在'; end if;
 if club.role_version<>p_expected then raise exception using errcode='PT409',message='角色已被修改，请刷新后重试'; end if;
 perform 1 from auth.users where id=p_user and (p_action='revoke' or email_confirmed_at is not null) for share;
 if not found then raise exception using errcode='22023',message='目标账户不存在或邮箱尚未验证'; end if;
 -- Row locks above may also wait (for example a concurrent account update). Recheck before any mutation.
 if not club_private.can_platform('platform.roles.assign') then raise exception using errcode='42501',message='需要超级管理员角色管理权限'; end if;
 if not club_private.super_admin_active() then raise exception using errcode='42501',message='需要已确认设备的两步验证会话'; end if;
 select status into old_status from public.club_memberships where club_id=p_club and user_id=p_user and role=p_role;
 select user_id into owner_id from public.club_memberships where club_id=p_club and role='owner' and status='active';
 if p_action='revoke' then
   if p_role='owner' and old_status='active' then raise exception using errcode='PT409',message='不能撤销有效公会长，请使用转让公会长'; end if;
   if old_status='active' then
     update public.club_memberships set status='revoked' where club_id=p_club and user_id=p_user and role=p_role;
     changed:=true;
   end if;
 else
   if p_role='owner' and owner_id is not null and owner_id<>p_user then
     if p_action<>'transfer' then raise exception using errcode='PT409',message='已有有效公会长，请使用转让'; end if;
     update public.club_memberships set status='revoked' where club_id=p_club and user_id=owner_id and role='owner';
     changed:=true;
   elsif p_action='transfer' and owner_id is null then
     raise exception using errcode='PT409',message='尚无有效公会长，请使用任命';
   end if;
   if old_status is distinct from 'active' then
     if p_role='admin' and (select count(*) from public.club_memberships where club_id=p_club and role='admin' and status='active')>=club.admin_limit then
       raise exception using errcode='PT409',message='有效管理员已达到人数上限';
     end if;
     insert into public.club_memberships(club_id,user_id,role,status) values(p_club,p_user,p_role,'active')
       on conflict(club_id,user_id,role) do update set status='active';
     changed:=true;
   end if;
 end if;
 if not changed then
   insert into public.platform_audit_events(actor_id,action,details) values(actor,'club_memberships.noop',jsonb_build_object('new',jsonb_build_object('club_id',p_club,'user_id',p_user,'role',p_role,'status',old_status)));
 end if;
 response:=jsonb_build_object('changed',changed,'role_version',(select role_version from public.club_clubs where id=p_club));
 insert into club_private.role_requests(actor_id,request_id,payload,result) values(actor,p_request,payload,response);
 return response;
end $$;
revoke all on function public.platform_role_context(uuid),public.platform_assign_role(uuid,uuid,text,text,bigint,uuid) from public,anon,service_role;
grant execute on function public.platform_role_context(uuid),public.platform_assign_role(uuid,uuid,text,text,bigint,uuid) to authenticated;
