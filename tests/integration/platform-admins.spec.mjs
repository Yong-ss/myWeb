import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,localFetch,state,totp,clubId,foreignClubId,baseURL,users,password} from './local.mjs';
// Stage E on real Supabase Auth + Worker + database: the Super Admin appoints a platform admin; that account signs in
// with no club role, gains platform powers only after its own real TOTP (no SQL Editor confirmation), manages club roles
// within the rules, cannot reach Super-Admin-only powers or identity, and loses everything at once when revoked.
const authApi=(path,token,body)=>localFetch(`/auth/v1/${path}`,{method:'POST',headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const aal2=async(token,name,trust)=>{
 const factor=await (await authApi('factors',token,{factor_type:'totp',friendly_name:name})).json();
 let session;
 for(let attempt=0;attempt<2&&!session;attempt++){const challenge=await (await authApi(`factors/${factor.id}/challenge`,token,{})).json();session=(await (await authApi(`factors/${factor.id}/verify`,token,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json()).access_token;}
 if(trust)sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
 return {factor:factor.id,token:session};
};

test('platform admin: appointed by the Super Admin, own TOTP only, club roles within the rules, no Super Admin powers or identity, revoked at once',async({request,page})=>{
 test.setTimeout(120000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const pa=users.outsider.id,factors=[];
 try{
  // Before appointment: no role anywhere, so sign-in is refused (unchanged rule).
  expect((await request.post(`${baseURL}/api/login`,{headers:{Origin:baseURL},data:{email:users.outsider.email,password}})).status()).toBe(403);
  const sa=await aal2((await auth('owner')).access_token,'Platform admins SA',true);factors.push(sa.factor);
  // Only the Super Admin appoints: an ordinary account and the database both refuse.
  const ordinary=(await auth('foreign')).access_token;
  expect((await post('admin/platform-admin',ordinary,{user_id:pa,action:'grant'})).status()).toBe(403);
  expect((await rest('rpc/platform_set_platform_admin',ordinary,{p_user:pa,p_action:'grant'})).status).toBe(403);
  expect((await post('admin/platform-admin',sa.token,{user_id:pa,action:'grant'})).status()).toBe(200);
  expect(sql(`select status from public.platform_role_assignments where user_id='${pa}';`)).toBe('active');
  expect(sql(`select count(*) from public.platform_audit_events where action='platform_role_assignments.insert' and actor_id='${users.owner.id}' and details#>>'{new,user_id}'='${pa}';`)).toBe('1');

  // Signs in without any club role; MFA setup works; no platform data yet.
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.outsider.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading',{name:'请完成两步验证'})).toBeVisible();
  const aal1=(await auth('outsider')).access_token;
  expect((await (await get('account',aal1)).json())).toMatchObject({platform_admin:true,super_admin:false,platform_permissions:[],permissions:[]});
  expect((await get('mfa',aal1)).status()).toBe(200);
  for(const path of ['admin/overview','admin/users','admin/activity'])expect((await get(path,aal1)).status(),path).toBe(403);
  expect((await rest('rpc/platform_overview',aal1,{})).status).toBe(403);

  // Own verified TOTP, never confirmed in SQL Editor: platform powers appear, exactly the two granted ones.
  const active=await aal2(aal1,'Platform admin phone',false);factors.push(active.factor);
  const account=await (await get('account',active.token)).json();
  expect(account.platform_permissions).toEqual(['platform.alliance_leaders.assign','platform.alliances.manage','platform.read','platform.roles.assign']); // stage F adds the two alliance powersexpect(account.permissions).toEqual([]);
  for(const path of ['admin/overview','admin/roles',`admin/permission-settings`])expect((await get(path,active.token)).status(),path).toBe(200);

  // Never sees who the Super Admin is: no flag, no device or list events, no actor email.
  const listed=await (await get(`admin/users?q=${encodeURIComponent(users.owner.email)}`,active.token)).json();
  expect(listed.users.length).toBe(1);expect(listed.users[0]).not.toHaveProperty('super_admin');
  const log=await (await get('admin/activity',active.token)).json();
  expect(log.events.some(e=>e.action.startsWith('platform_super_admin'))).toBe(false);
  const appointed=log.events.find(e=>e.action==='platform_role_assignments.insert');expect(appointed.actor).toBeNull();expect(appointed.actor_kind).toBe('super_admin');
  expect(log.events.filter(e=>e.actor===users.owner.email)).toEqual([]); // the Super Admin's email is never shown as an actor
  expect(await (await get(`admin/permission-explain?club=${clubId}&user=${users.owner.id}`,active.token)).json()).not.toHaveProperty('super_admin');
  // The Super Admin changes their own club role: through the Worker and the RPC, none of their events carries their
  // email or id for the platform admin, and no membership time can be matched to those events.
  const ctx=async()=>(await (await get(`admin/role-context?user=${users.owner.id}`,sa.token)).json()).clubs.find(c=>c.id===foreignClubId).role_version;
  expect((await post('admin/assign-role',sa.token,{club_id:foreignClubId,user_id:users.owner.id,role:'admin',action:'grant',expected_version:await ctx(),request_id:randomUUID()})).status()).toBe(200);
  for(const events of [(await (await get('admin/activity',active.token)).json()).events,(await (await rest('rpc/platform_activity',active.token,{})).json()).events]){
   const theirs=events.filter(e=>e.actor_kind==='super_admin');expect(theirs.some(e=>e.action==='club_memberships.insert'||e.action==='club_memberships.update')).toBe(true);
   for(const e of theirs){const text=JSON.stringify(e);expect(text).not.toContain(users.owner.id);expect(text).not.toContain(users.owner.email);expect(e.subject).toBeNull();}
  }
  const rows=(await (await get(`admin/users?q=${encodeURIComponent(users.owner.email)}`,active.token)).json()).users[0].memberships;
  expect(rows.length).toBeGreaterThan(0);for(const m of rows)expect(m).not.toHaveProperty('created_at');
  // The Super Admin still sees the full record.
  expect((await (await get('admin/activity',sa.token)).json()).events.some(e=>e.subject===users.owner.email&&e.details?.new?.user_id===users.owner.id)).toBe(true);
  expect(JSON.stringify(await (await rest('rpc/platform_users',active.token,{p_query:users.owner.email})).json())).not.toContain('super_admin');

  // Club roles through the same transaction, in a club where they have no role.
  const version=async()=>(await (await get(`admin/role-context?user=${users.admin.id}`,active.token)).json()).clubs.find(c=>c.id===foreignClubId).role_version;
  const grant={club_id:foreignClubId,user_id:users.admin.id,role:'admin',action:'grant',expected_version:await version(),request_id:randomUUID()};
  expect((await post('admin/assign-role',active.token,grant)).status()).toBe(200);
  expect(sql(`select status from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}' and role='admin';`)).toBe('active');
  expect(sql(`select count(*) from public.platform_audit_events where actor_id='${pa}' and action='club_memberships.insert';`)).not.toBe('0');
  // Never their own role.
  const own=()=>sql(`select count(*) from public.club_memberships where user_id='${pa}' and status='active';`),before=own();
  const selfGrant={...grant,user_id:pa,role:'owner',expected_version:await version(),request_id:randomUUID()};
  expect((await post('admin/assign-role',active.token,selfGrant)).status()).toBe(403);
  expect((await post('admin/assign-role',active.token,{...selfGrant,club_id:clubId,role:'admin',request_id:randomUUID(),expected_version:(await (await get(`admin/role-context?user=${pa}`,active.token)).json()).clubs.find(c=>c.id===clubId).role_version})).status()).toBe(403);
  expect(own()).toBe(before);
  // Never Super-Admin-only powers, through the Worker or the database directly.
  expect((await post('admin/admin-limit',active.token,{club_id:foreignClubId,admin_limit:1})).status()).toBe(403);
  expect((await post('admin/role-permission',active.token,{layer:'cap',role:'admin',permission:'imports.delete',value:false})).status()).toBe(403);
  expect((await post('admin/personal-permission',active.token,{club_id:clubId,user_id:users.admin.id,permission:'members.read',value:false})).status()).toBe(403);
  expect((await post('admin/platform-admin',active.token,{user_id:users.foreign.id,action:'grant'})).status()).toBe(403);
  for(const [fn,body] of [['platform_set_admin_limit',{p_club:foreignClubId,p_limit:1}],['platform_set_role_permission',{p_layer:'cap',p_role:'admin',p_permission:'imports.delete',p_value:false}],
   ['platform_set_personal_permission',{p_club:clubId,p_user:users.admin.id,p_permission:'members.read',p_value:false}],['platform_set_platform_admin',{p_user:users.foreign.id,p_action:'grant'}]])
   expect((await rest(`rpc/${fn}`,active.token,body)).status,fn).toBe(403);
  for(const table of ['platform_role_assignments','platform_super_admins','platform_audit_events'])expect((await rest(`${table}?select=*`,active.token)).status,table).not.toBe(200);
  expect(sql(`select admin_limit from public.club_clubs where id='${foreignClubId}';`)).toBe('5');
  // No club data either: they hold no club role.
  expect((await get(`members?club=${foreignClubId}`,active.token)).status()).toBe(403);

  // Revocation: the very next request is refused, through the Worker and the database.
  expect((await post('admin/platform-admin',sa.token,{user_id:pa,action:'revoke'})).status()).toBe(200);
  expect((await get('admin/overview',active.token)).status()).toBe(403);
  expect((await rest('rpc/platform_overview',active.token,{})).status).toBe(403);
  expect((await post('admin/assign-role',active.token,{...grant,action:'revoke',expected_version:await version().catch(()=>0),request_id:randomUUID()})).status()).toBe(403);
  expect(sql(`select status from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}' and role='admin';`)).toBe('active');
 }finally{
  sql(`delete from public.club_memberships where club_id='${foreignClubId}' and user_id in ('${users.admin.id}','${users.owner.id}');
   update public.platform_role_assignments set status='revoked' where user_id='${pa}';
   ${factors.map(f=>`delete from auth.mfa_factors where id='${f}';`).join('')}`);
 }
});
