import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,audits,clubId,foreignClubId,baseURL,users} from './local.mjs';

// Stage C on real Supabase + Worker: the owner (no MFA, so no Super Admin powers) appoints and adjusts admins of their
// own club; the target's real access changes on the very next request in the Worker and in RLS; admins and other
// clubs' owners are refused; caps and other clubs stay out of reach; every change is in the club log.
test('owner manages this club’s admins: immediate in Worker and RLS, bounded by caps and the club, audited',async({request})=>{
 test.setTimeout(90000);
 const [owner,admin,foreign]=await Promise.all(['owner','admin','foreign'].map(async r=>(await auth(r)).access_token));
 const call=(method,path,token,data)=>request[method](`${baseURL}/api/${path}`,{headers:{Cookie:`__Host-club_access=${token}`,...(method==='post'?{Origin:baseURL}:{})},...(data?{data}:{})});
 const members=async token=>(await call('get','members',token)).status();
 const rows=async token=>await (await rest(`club_players?select=id&club_id=eq.${clubId}`,token)).json();
 const role=async(action,user)=>{const team=await (await call('get','team',owner)).json();return call('post','team/role',owner,{user_id:user,action,expected_version:team.role_version,request_id:randomUUID()});};
 try{
  // Admins and another club's owner are refused by the Worker and by the database.
  for(const token of [admin,foreign]){
   for(const path of ['team','team/permissions','team/candidate?email=outsider@club.test'])expect((await call('get',path,token)).status()).toBe(403);
   expect((await call('post','team/role',token,{user_id:users.outsider.id,action:'grant',expected_version:0,request_id:randomUUID()})).status()).toBe(403);
   expect((await rest('rpc/club_change_admin',token,{p_club:clubId,p_user:users.outsider.id,p_action:'grant',p_expected:0,p_request:randomUUID()})).status).toBe(403);
   expect((await rest('rpc/club_set_admin_default',token,{p_club:clubId,p_permission:'club.rename',p_value:true})).status).toBe(403);
  }
  const team=await (await call('get','team',owner)).json();
  expect(team.admins.map(a=>a.email)).toEqual(['admin@club.test']);expect(team.admin_limit).toBe(5);
  // Appoint the outsider by email: before, no access; after, the next request is allowed.
  const outsider=(await auth('outsider')).access_token;
  expect(await members(outsider)).toBe(403);
  const candidate=await (await call('get','team/candidate?email=OUTSIDER@club.test',owner)).json();
  expect(candidate).toMatchObject({user_id:users.outsider.id,role:null,kept:[]});
  // Stage E: a Super Admin's account is found like any confirmed account (here the owner's own, already the owner), so
  // the answer never singles out the Super Admin; unknown accounts still get 400.
  expect(await (await call('get','team/candidate?email=owner@club.test',owner)).json()).toMatchObject({user_id:users.owner.id,role:'owner'});
  expect((await call('get','team/candidate?email=nobody@club.test',owner)).status()).toBe(400);
  expect((await role('grant',users.outsider.id)).status()).toBe(200);
  expect(await members(outsider)).toBe(200);expect((await rows(outsider)).length).toBeGreaterThan(0);
  // A personal deny from the owner applies at once in the Worker and RLS; the explanation says why.
  expect((await call('post','team/personal',owner,{user_id:users.outsider.id,permission:'members.read',value:false})).status()).toBe(200);
  expect(await members(outsider)).toBe(403);expect(await rows(outsider)).toEqual([]);
  const explained=(await (await call('get','team/permissions',owner)).json()).admins.find(a=>a.user_id===users.outsider.id).explain;
  expect(explained.permissions.find(p=>p.key==='members.read')).toMatchObject({layer:'owner_deny',allowed:false});expect(explained).not.toHaveProperty('super_admin');
  expect((await call('post','team/personal',owner,{user_id:users.outsider.id,permission:'members.read',value:null})).status()).toBe(200);
  expect(await members(outsider)).toBe(200);
  // Club default for admins: applies to every admin of this club only.
  expect((await call('post','team/default',owner,{permission:'club.rename',value:true})).status()).toBe(200);
  expect(await (await rest('rpc/club_my_permissions',admin,{p_club:clubId})).json()).toContain('club.rename');
  // Never beyond the Super Admin's cap, never another club, never themselves, never a management power, no club id from the client.
  sql(`insert into public.auth_role_cap_blocks values('admin','imports.delete');`);
  expect((await call('post','team/default',owner,{permission:'imports.delete',value:true})).status()).toBe(409);
  expect((await call('post','team/personal',owner,{user_id:users.admin.id,permission:'imports.delete',value:true})).status()).toBe(409);
  expect(await (await rest('rpc/club_my_permissions',admin,{p_club:clubId})).json()).not.toContain('imports.delete');
  expect((await call('post','team/personal',owner,{user_id:users.admin.id,permission:'club.admins.manage',value:true})).status()).toBe(409);
  expect((await call('post','team/personal',owner,{user_id:users.owner.id,permission:'members.read',value:false})).status()).toBe(403);
  expect((await call('post','team/default',owner,{permission:'club.rename',value:true,club_id:foreignClubId})).status()).toBe(400);
  expect((await rest('rpc/club_set_admin_default',owner,{p_club:foreignClubId,p_permission:'club.rename',p_value:true})).status).toBe(403);
  expect((await rest('rpc/club_change_admin',owner,{p_club:foreignClubId,p_user:users.outsider.id,p_action:'grant',p_expected:0,p_request:randomUUID()})).status).toBe(403);
  expect((await rest('rpc/platform_set_admin_limit',owner,{p_club:clubId,p_limit:50})).status).toBe(403);
  // Revocation: the next request is refused; the change is in the club log with the owner as actor.
  expect((await role('revoke',users.outsider.id)).status()).toBe(200);
  expect(await members(outsider)).toBe(403);expect(await rows(outsider)).toEqual([]);
  const log=audits(`club_id='${clubId}' and action like 'admin_%' and actor_id='${users.owner.id}'`).map(e=>e.action);
  expect(log).toEqual(['admin_appointed','admin_permission_changed','admin_permission_changed','admin_default_changed','admin_revoked']);
 }finally{
  sql(`update public.club_memberships set status='revoked' where club_id='${clubId}' and user_id='${users.outsider.id}';
   delete from public.club_permission_overrides where club_id='${clubId}';delete from public.club_role_permissions where club_id='${clubId}';
   delete from public.auth_role_cap_blocks where role_key='admin' and permission_key='imports.delete';`);
 }
});
