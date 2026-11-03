import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,localFetch,state,totp,clubId,baseURL,users} from './local.mjs';

// Stage B on real Supabase + Worker: only a trusted-MFA Super Admin changes permission layers; a change applies to the
// very next request in both the Worker and the database (RLS); the explanation equals what the user really gets.
const authApi=(path,token,body,method='POST')=>localFetch(`/auth/v1/${path}`,{method,headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});

test('permission layers: Super Admin only, immediate in Worker and RLS, audited, explanation equals can()',async({request})=>{
 test.setTimeout(90000);
 const other=randomUUID();
 sql(`insert into public.club_clubs(id,name) values('${other}','Layers other club');
 insert into public.club_memberships(club_id,user_id,role) values('${other}','${users.admin.id}','admin');`);
 const post=(path,token,body)=>request.post(`${baseURL}/api/admin/${path}`,{headers:{Cookie:`__Host-club_access=${token}`,Origin:baseURL},data:body});
 const get=(path,token)=>request.get(`${baseURL}/api/${path}`,{headers:{Cookie:`__Host-club_access=${token}`}});
 const deny={club_id:clubId,user_id:users.admin.id,permission:'members.read',value:false};
 const cap={layer:'cap',role:'admin',permission:'imports.delete',value:false};
 const refused=async token=>{
  expect((await post('personal-permission',token,deny)).status()).toBe(403);expect((await post('role-permission',token,cap)).status()).toBe(403);
  expect((await rest('rpc/platform_set_personal_permission',token,{p_club:clubId,p_user:users.admin.id,p_permission:'members.read',p_value:false})).status).toBe(403);
  expect((await rest('rpc/platform_set_role_permission',token,{p_layer:'cap',p_role:'admin',p_permission:'imports.delete',p_value:false})).status).toBe(403);
  expect((await rest('rpc/platform_permission_explain',token,{p_club:clubId,p_user:users.admin.id})).status).toBe(403);
  for(const table of ['club_permission_overrides','club_role_permissions','auth_role_cap_blocks'])expect((await rest(`${table}?select=*`,token)).status).not.toBe(200);
 };
 const adminToken=(await auth('admin')).access_token;
 for(const role of ['admin','foreign','outsider','owner'])await refused((await auth(role)).access_token);
 const aal1=(await auth('owner')).access_token;
 const factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'Layers integration'})).json();
 try{
  const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  const token=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json()).access_token;
  // aal2 alone (device not confirmed in SQL Editor) is still refused.
  await refused(token);sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  const mine=async club=>await (await rest('rpc/club_my_permissions',adminToken,{p_club:club})).json();
  const explained=async club=>(await (await get(`admin/permission-explain?club=${club}&user=${users.admin.id}`,token)).json()).permissions.filter(p=>p.allowed).map(p=>p.key).sort();
  expect(await mine(clubId)).toContain('members.read');expect(await explained(clubId)).toEqual(await mine(clubId));
  expect((await get('members',adminToken)).status()).toBe(200);
  // Forced personal deny: the next Worker request and the database (RLS) both refuse, in this club only.
  expect((await post('personal-permission',token,deny)).status()).toBe(200);
  expect((await get('members',adminToken)).status()).toBe(403);
  expect(await (await rest(`club_players?select=id&club_id=eq.${clubId}`,adminToken)).json()).toEqual([]);
  expect(await mine(other)).toContain('members.read');
  expect(await explained(clubId)).toEqual(await mine(clubId));
  expect(sql(`select count(*) from public.platform_audit_events where action='club_permission_overrides.insert' and actor_id='${users.owner.id}' and details#>>'{new,user_id}'='${users.admin.id}' and details#>>'{new,allowed}'='false';`)).toBe('1');
  // Back to "follow": immediately restored.
  expect((await post('personal-permission',token,{...deny,value:null})).status()).toBe(200);
  expect((await get('members',adminToken)).status()).toBe(200);
  // A cap beats a forced allow; the database refusal of a non-club permission reaches the UI as a 400.
  expect((await post('personal-permission',token,{...deny,permission:'imports.delete',value:true})).status()).toBe(200);
  expect(await mine(clubId)).toContain('imports.delete');
  expect((await post('role-permission',token,cap)).status()).toBe(200);
  expect(await mine(clubId)).not.toContain('imports.delete');expect(await mine(other)).not.toContain('imports.delete');
  const reason=(await (await get(`admin/permission-explain?club=${clubId}&user=${users.admin.id}`,token)).json()).permissions.find(p=>p.key==='imports.delete');
  expect(reason).toMatchObject({layer:'cap',allowed:false,forced:true,cap_blocked:true});
  expect((await post('role-permission',token,{layer:'platform_default',role:'admin',permission:'platform.read',value:true})).status()).toBe(400);
  expect(await explained(clubId)).toEqual(await mine(clubId));
  // Club default in the other club only.
  expect((await post('role-permission',token,{layer:'club_default',role:'admin',permission:'club.rename',value:true,club_id:other})).status()).toBe(200);
  expect(await mine(other)).toContain('club.rename');expect(await mine(clubId)).not.toContain('club.rename');
  const settings=await (await get(`admin/permission-settings?club=${other}`,token)).json();
  expect(settings.club_defaults).toEqual([{role:'admin',permission:'club.rename',allowed:true}]);expect(settings.cap_blocks).toContainEqual({role:'admin',permission:'imports.delete'});
 }finally{
  sql(`delete from public.club_permission_overrides where user_id='${users.admin.id}';delete from public.club_role_permissions where club_id='${other}';delete from public.auth_role_cap_blocks where role_key='admin' and permission_key='imports.delete';
   update public.club_memberships set status='revoked' where club_id='${other}';delete from auth.mfa_factors where id='${factor.id}';`);
 }
});
