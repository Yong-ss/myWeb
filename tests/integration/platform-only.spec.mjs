import {test,expect} from '@playwright/test';
import {rest,sql,localFetch,state,totp,baseURL,password} from './local.mjs';
// A Super Admin with no club membership at all: platform identity alone must give a working login and a clear MFA path,
// never platform data before trusted MFA, and club business access only through the database's Super Admin rule.
const authApi=(path,token,body,method='POST')=>localFetch(`/auth/v1/${path}`,{method,headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('a Super Admin without any membership signs in to the platform, is guided to MFA and gains platform access only after trusted MFA',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
 const key=state().serviceKey,email=`platform-only-${Date.now()}@club.test`;
 const created=await (await localFetch('/auth/v1/admin/users',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})})).json();
 sql(`insert into public.platform_super_admins(user_id) values('${created.id}');`);
 try{
  expect(sql(`select count(*) from public.club_memberships where user_id='${created.id}';`)).toBe('0');
  const seen=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))seen.push(u.pathname);});
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading',{name:'请完成两步验证'})).toBeVisible();
  await expect(page.getByRole('link',{name:'前往两步验证'})).toHaveAttribute('href','/admin/security');
  // Account security is a platform page: reachable and usable without any club membership.
  await expect(page.getByRole('link',{name:'账户安全'}).first()).toHaveAttribute('href','/admin/security');
  await page.getByRole('link',{name:'前往两步验证'}).click();await expect(page).toHaveURL(/\/admin\/security$/);
  await expect(page.getByRole('heading',{name:/两步验证/})).toBeVisible();await expect(page.getByRole('button',{name:'开始绑定'})).toBeVisible();
  await expect(page.getByText('俱乐部名称',{exact:true})).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.locator('.club-header-account')).toContainText('超级管理员（待两步验证）');
  await expect(page.locator('.club-header-account')).not.toContainText('·'); // no club role is invented
  await expect(page.getByRole('link',{name:'俱乐部工作空间'})).toHaveCount(0);
  expect(seen.filter(p=>p.startsWith('/api/admin/'))).toEqual([]);
  // The server refuses platform data to this aal1 session no matter what the page shows.
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-club_access');
  const aal1=cookie.value,asCookie=t=>({Cookie:`__Host-club_access=${t}`});
  for(const path of ['overview','users','roles','activity'])expect((await page.request.get(`${baseURL}/api/admin/${path}`,{headers:asCookie(aal1)})).status()).toBe(403);
  expect((await rest('rpc/platform_role_context',aal1,{p_user:created.id})).status).toBe(403);
  // Club pages stay on their URL (no redirect loop) and the business APIs and RLS refuse.
  await page.goto('/members');await expect(page).toHaveURL(/\/members$/);await expect(page.getByText('此账户没有权限执行这个操作').first()).toBeVisible();
  for(const path of ['members','activity','club-settings','import-context?date=2026-10-01'])expect((await page.request.get(`${baseURL}/api/${path}`,{headers:asCookie(aal1)})).status()).toBe(403);
  expect(await (await rest('club_players?select=id',aal1)).json()).toEqual([]);
  await page.reload();await expect(page).toHaveURL(/\/members$/);
  // Trusted MFA: the same account gains platform access, through the real Auth aal2 session only.
  const factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'platform-only'})).json();
  let aal2;
  for(let attempt=0;attempt<2&&!aal2;attempt++){const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();aal2=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json()).access_token;}
  expect((await page.request.get(`${baseURL}/api/admin/overview`,{headers:asCookie(aal2)})).status()).toBe(403); // aal2 alone: factor not yet trusted
  sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  expect((await page.request.get(`${baseURL}/api/admin/overview`,{headers:asCookie(aal2)})).status()).toBe(200);
  await context.addCookies([{name:'__Host-club_access',value:aal2,url:baseURL,httpOnly:true,secure:true,sameSite:'Strict'}]);
  await page.goto('/admin');await expect(page.getByRole('tab',{name:'用户与角色'})).toBeVisible();
  await expect(page.locator('.club-header-account')).toContainText('超级管理员');await expect(page.locator('.club-header-account')).not.toContainText('待两步验证');
 }finally{
  sql(`delete from auth.mfa_factors where user_id='${created.id}';delete from public.platform_super_admins where user_id='${created.id}';`);
 }
});

// Trusted MFA belongs to the Auth session, not to the access token: reopening the browser and refreshing an expired
// access token keep it (Auth carries aal2 into refreshed tokens), while logout or a new password login require MFA again.
test('an aal2 session survives reopen, refresh and parallel refreshes; logout and a new login need MFA again',async({browser})=>{
 const key=state().serviceKey,email=`session-${Date.now()}@club.test`;
 const created=await (await localFetch('/auth/v1/admin/users',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})})).json();
 sql(`insert into public.platform_super_admins(user_id) values('${created.id}');`);
 try{
  const signIn=async()=>(await localFetch('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:state().anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})})).json();
  const aal1=(await signIn()).access_token;
  const factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'session'})).json();
  const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  const session=await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json();
  sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  const jar=(access,refresh)=>[...(access?[{name:'__Host-club_access',value:access}]:[]),{name:'__Host-club_refresh',value:refresh}].map(c=>({...c,url:baseURL,httpOnly:true,secure:true,sameSite:'Strict'}));
  const open=async cookies=>{const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true});await context.addCookies(cookies);return context;};
  const account=async context=>{const r=await context.request.get(`${baseURL}/api/account`);return {status:r.status(),body:r.ok()?await r.json():null};};
  // Reopened browser with the persisted cookies: still the active Super Admin, and /login forwards instead of re-logging in.
  let context=await open(jar(session.access_token,session.refresh_token));
  expect((await account(context)).body).toMatchObject({mfa_verified:true});
  const page=await context.newPage();await page.goto('/login');await expect(page).toHaveURL(/\/admin$/);await expect(page.getByRole('tab',{name:'用户与角色'})).toBeVisible();
  await page.reload();await expect(page.getByRole('tab',{name:'用户与角色'})).toBeVisible();
  await context.close();
  // Access token gone (expired): only the refresh cookie remains. Parallel page requests all refresh and stay aal2.
  context=await open(jar(null,session.refresh_token));
  const parallel=await Promise.all(['account','admin/overview','admin/users','mfa'].map(p=>context.request.get(`${baseURL}/api/${p}`)));
  expect(parallel.map(r=>r.status())).toEqual([200,200,200,200]);
  expect((await parallel[0].json()).mfa_verified).toBe(true);
  expect((await account(context)).body).toMatchObject({mfa_verified:true}); // the renewed cookies keep working
  // Logout ends the session: its refresh token is dead, and a new password login is aal1 until MFA again.
  expect((await context.request.post(`${baseURL}/api/logout`,{headers:{Origin:baseURL},data:{}})).status()).toBe(200);
  await context.close();
  context=await open(jar(null,session.refresh_token));expect((await account(context)).status).toBe(401);await context.close();
  const fresh=await signIn();context=await open(jar(fresh.access_token,fresh.refresh_token));
  expect((await account(context)).body).toMatchObject({mfa_verified:false,mfa_session:false});
  expect((await context.request.get(`${baseURL}/api/admin/overview`)).status()).toBe(403);
  await context.close();
 }finally{
  sql(`delete from auth.mfa_factors where user_id='${created.id}';delete from public.platform_super_admins where user_id='${created.id}';`);
 }
});
