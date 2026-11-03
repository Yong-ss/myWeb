import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,localFetch,state,totp,clubId,foreignClubId,baseURL,users} from './local.mjs';
// Stage G on real Supabase Auth + Worker + database: removing an account from every club. The admin account holds the
// admin role in A and B here; foreign owns B.
const authApi=(path,token,body)=>localFetch(`/auth/v1/${path}`,{method:'POST',headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const aal2=async(role,name,trust)=>{
 const t=(await auth(role)).access_token,f=await (await authApi('factors',t,{factor_type:'totp',friendly_name:name})).json();let s;
 for(let i=0;i<2&&!s;i++){const ch=await (await authApi(`factors/${f.id}/challenge`,t,{})).json();s=(await (await authApi(`factors/${f.id}/verify`,t,{challenge_id:ch.id,code:totp(f.totp.secret)})).json()).access_token;}
 if(trust)sql(`select club_private.trust_super_admin_factor('${f.id}');`);
 return {factor:f.id,token:s};
};

test('remove from every club: Super Admin only, preview-exact, owners refused, immediate, nothing else changes',async({request})=>{
 test.setTimeout(120000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const factors=[];
 sql(`insert into public.club_memberships(club_id,user_id,role) values('${foreignClubId}','${users.admin.id}','admin') on conflict (club_id,user_id,role) do update set status='active';
  insert into public.platform_role_assignments(user_id,role) values('${users.admin.id}','platform_admin') on conflict (user_id,role) do update set status='active';`);
 try{
  const sa=await aal2('owner','Bulk SA',true);factors.push(sa.factor);
  const preview=async user=>{const c=await (await get(`admin/role-context?user=${user}`,sa.token)).json();
   return Object.fromEntries(c.memberships.filter(m=>m.status==='active').map(m=>[m.club_id,c.clubs.find(x=>x.id===m.club_id).role_version]));};
  const admin=(await auth('admin')).access_token;
  expect((await get(`members?club=${clubId}`,admin)).status()).toBe(200);
  // Refused for a platform admin (with TOTP), an owner and the Super Admin without MFA, via the Worker and the RPC.
  const pa=await aal2('foreign','Bulk PA',false);factors.push(pa.factor);
  sql(`insert into public.platform_role_assignments(user_id,role) values('${users.foreign.id}','platform_admin') on conflict (user_id,role) do update set status='active';`);
  const body={user_id:users.admin.id,expected:await preview(users.admin.id),request_id:randomUUID()};
  for(const t of [pa.token,(await auth('owner')).access_token]){
   expect((await post('admin/remove-from-all-clubs',t,body)).status()).toBe(403);
   expect((await rest('rpc/platform_remove_from_all_clubs',t,{p_user:users.admin.id,p_expected:body.expected,p_request:randomUUID()})).status).toBe(403);
  }
  // An owner is refused as a whole: foreign owns B; nothing changes for them.
  const ownerTry=await post('admin/remove-from-all-clubs',sa.token,{user_id:users.foreign.id,expected:await preview(users.foreign.id),request_id:randomUUID()});
  expect(ownerTry.status()).toBe(409);expect((await ownerTry.json()).error).toContain('请先转让公会长');
  expect(sql(`select string_agg(role,',') from public.club_memberships where user_id='${users.foreign.id}' and status='active';`)).toBe('owner');
  // A stale preview (B changed after it was read) refuses the whole removal.
  const stale=await post('admin/remove-from-all-clubs',sa.token,{...body,expected:{...body.expected,[foreignClubId]:body.expected[foreignClubId]-1},request_id:randomUUID()});
  expect(stale.status()).toBe(409);expect(sql(`select count(*) from public.club_memberships where user_id='${users.admin.id}' and status='active';`)).toBe('2');
  // Forged extras are refused before the database.
  expect((await post('admin/remove-from-all-clubs',sa.token,{...body,user_ids:[users.foreign.id]})).status()).toBe(400);
  // Success: both roles end at once; the account, its platform identity, other accounts and history stay.
  const done=await post('admin/remove-from-all-clubs',sa.token,body);expect(done.status()).toBe(200);
  expect((await done.json()).clubs.map(c=>c.id).sort()).toEqual([clubId,foreignClubId].sort());
  expect((await get(`members?club=${clubId}`,admin)).status()).toBe(403);
  expect((await get(`members?club=${foreignClubId}`,admin)).status()).toBe(403);
  expect(await (await rest(`club_players?select=id&club_id=eq.${clubId}`,admin)).json()).toEqual([]);
  expect(sql(`select count(*) from auth.users where id='${users.admin.id}';`)).toBe('1');
  expect(sql(`select status from public.platform_role_assignments where user_id='${users.admin.id}';`)).toBe('active');
  expect(sql(`select string_agg(role,',') from public.club_memberships where user_id='${users.owner.id}' and status='active';`)).toBe('owner');
  expect(Number(sql(`select count(*) from public.platform_audit_events where actor_id='${users.owner.id}' and action='club_memberships.update' and details#>>'{new,user_id}'='${users.admin.id}' and details#>>'{new,status}'='revoked';`))).toBeGreaterThanOrEqual(2);
  // Replay of the same request answers the same and changes nothing.
  expect((await (await post('admin/remove-from-all-clubs',sa.token,body)).json()).clubs.length).toBe(2);
 }finally{
  sql(`update public.club_memberships set status='active' where club_id='${clubId}' and user_id='${users.admin.id}' and role='admin';
   delete from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}';
   update public.platform_role_assignments set status='revoked' where user_id in ('${users.admin.id}','${users.foreign.id}');
   ${factors.map(f=>`delete from auth.mfa_factors where id='${f}';`).join('')}`);
 }
});
