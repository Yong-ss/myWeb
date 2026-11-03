import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,localFetch,state,totp,baseURL,users} from './local.mjs';
// Plan A on real Supabase Auth + Worker + database. In a club of its own, the outsider is the owner and also leads the
// alliance that club belongs to, so it reads audit.read there both as owner and as leader. The Super Admin then caps
// the owner role's audit.read. Why it matters: the leader read is read-only and must stay, but it must never let the
// owner hand audit.read to an admin (Worker 403 and RPC refusal, nothing written, nothing logged); the Super Admin's
// own grant to that admin is a separate, legitimate path and must keep working. Integration specs run serially, so the
// platform-wide owner cap set here is removed again in finally.
const authApi=(path,token,body)=>localFetch(`/auth/v1/${path}`,{method:'POST',headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('owner who also leads the alliance: capped audit.read stays readable but cannot be granted to an admin',async({request})=>{
 test.setTimeout(90000);
 const B=randomUUID(),A=randomUUID(),cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const owner=users.outsider.id,admin=users.admin.id;let factor;
 sql(`insert into public.club_clubs(id,name) values('${B}','Bound integration club');
  insert into public.club_memberships(club_id,user_id,role) values('${B}','${owner}','owner'),('${B}','${admin}','admin');
  insert into public.club_alliances(id,name) values('${A}','Bound integration alliance');
  insert into public.club_alliance_members(alliance_id,club_id) values('${A}','${B}');
  insert into public.alliance_leaders(alliance_id,user_id) values('${A}','${owner}');`);
 const ownerSettings=()=>sql(`select count(*) from public.club_permission_overrides where club_id='${B}' and set_by='owner';`)+'/'+sql(`select count(*) from public.club_role_permissions where club_id='${B}';`);
 const clubLog=()=>sql(`select count(*) from public.club_audit_events where club_id='${B}';`);
 const adminReads=async t=>(await (await get(`account?club=${B}`,t)).json()).permissions.includes('audit.read');
 try{
  const aal1=(await auth('owner')).access_token;
  factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'Bound integration'})).json();
  const ch=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  const sa=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:ch.id,code:totp(factor.totp.secret)})).json()).access_token;
  sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  const o=(await auth('outsider')).access_token,a=(await auth('admin')).access_token;
  // Make the admin not hold audit.read (the owner's own deny), so the later "follow" or "allow" would widen it.
  expect((await post(`team/personal?club=${B}`,o,{user_id:admin,permission:'audit.read',value:false})).status()).toBe(200);
  expect(await adminReads(a)).toBe(false);
  expect((await post('admin/role-permission',sa,{layer:'cap',role:'owner',permission:'audit.read',value:false})).status()).toBe(200);
  // The leader read stays: the owner still reads B's log, now only through the alliance path.
  expect((await (await get(`account?club=${B}`,o)).json()).permissions).toContain('audit.read');
  expect((await get(`activity?club=${B}`,o)).status()).toBe(200);
  const before={settings:ownerSettings(),log:clubLog()};
  // Worker: both widening paths are refused with the plan A message.
  for(const value of [true,null]){
   const r=await post(`team/personal?club=${B}`,o,{user_id:admin,permission:'audit.read',value});
   expect(r.status(),String(value)).toBe(403);expect((await r.json()).error).toBe('不能授予你作为本俱乐部公会长没有的权限');
  }
  const d=await post(`team/default?club=${B}`,o,{permission:'audit.read',value:true});
  expect(d.status()).toBe(403);
  // Database directly (PostgREST with the owner's token): the same refusal.
  const direct=await rest('rpc/club_set_admin_permission',o,{p_club:B,p_user:admin,p_permission:'audit.read',p_value:true});
  expect(direct.status).toBe(403);expect((await direct.json()).message).toBe('不能授予你作为本俱乐部公会长没有的权限');
  expect((await rest('rpc/club_set_admin_default',o,{p_club:B,p_permission:'audit.read',p_value:true})).status).toBe(403);
  // Nothing changed: same owner settings, no club log entry, the admin still cannot read the log.
  expect({settings:ownerSettings(),log:clubLog()}).toEqual(before);
  expect(sql(`select allowed from public.club_permission_overrides where club_id='${B}' and user_id='${admin}' and set_by='owner' and permission_key='audit.read';`)).toBe('f');
  expect(await adminReads(a)).toBe(false);expect((await get(`activity?club=${B}`,a)).status()).toBe(403);
  // Narrowing still works for the owner (unchanged rule).
  expect((await post(`team/personal?club=${B}`,o,{user_id:admin,permission:'members.read',value:false})).status()).toBe(200);
  // The Super Admin's own personal grant to that admin is unaffected and applies at once.
  expect((await post('admin/personal-permission',sa,{club_id:B,user_id:admin,permission:'audit.read',value:true})).status()).toBe(200);
  expect(await adminReads(a)).toBe(true);expect((await get(`activity?club=${B}`,a)).status()).toBe(200);
 }finally{
  sql(`delete from public.auth_role_cap_blocks where role_key='owner' and permission_key='audit.read';
   delete from public.club_permission_overrides where club_id='${B}';
   update public.alliance_leaders set status='revoked' where alliance_id='${A}';update public.club_alliance_members set status='left' where alliance_id='${A}';
   update public.club_memberships set status='revoked' where club_id='${B}';`);
  if(factor)sql(`delete from auth.mfa_factors where id='${factor.id}';`);
 }
});
