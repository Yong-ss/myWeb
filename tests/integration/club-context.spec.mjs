import {test,expect} from '@playwright/test';
import {auth,rest,sql,localFetch,state,clubId,foreignClubId,baseURL,users,password} from './local.mjs';
// Phase 2: sign-in and identity come from club_my_context (no fixed club); club data is still authorized per club.
// Stage D: every club is entered through its own URL (?club=); the default club (A) never answers for another.
const signIn=async(page,role)=>{await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users[role].email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();};
const rpc=(token,body={})=>localFetch('/rest/v1/rpc/club_my_context',{method:'POST',headers:{apikey:state().anonKey,...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});

test('a role only in club B signs in to club B and cannot read club A',async({page,context})=>{
 await context.route('**/*',r=>new URL(r.request().url()).origin===baseURL?r.continue():r.abort());
 const seen=[],problems=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))seen.push(u.pathname);});
 page.on('pageerror',e=>problems.push(e.message)); // uncaught exceptions; expected 401/403 responses are not errors
 // Their only club opens directly, by its own id; club A (the Worker default) is never shown.
 await signIn(page,'foreign');await expect(page).toHaveURL(`/account?club=${foreignClubId}`);
 await expect(page.locator('.club-brand-name')).toHaveText('Integration club B');
 await page.goto('/clubs');
 const card=page.getByRole('main');await expect(card.getByText('Integration club B')).toBeVisible();
 await expect(card.getByRole('link',{name:'进入Integration club B'})).toHaveAttribute('href',`/account?club=${foreignClubId}`);
 // The hub shows only the account's own clubs: it never asks for club A's name or data, and renders without errors.
 seen.length=0;problems.length=0;await page.reload();await expect(card.getByText('Integration club B')).toBeVisible();
 expect([...new Set(seen)]).toEqual(['/api/account']);expect(problems).toEqual([]);
 await expect(page.locator('.club-brand-name')).toHaveText('俱乐部数据检测平台');
 // The hub describes the account, not a club role: no 「成员」 borrowed from club A where they have no role.
 const label=page.locator('.club-user-name small');await expect(label).toHaveText('所属 1 个俱乐部');await expect(label).not.toContainText('成员');
 const account=await (await context.request.get(`${baseURL}/api/account`)).json();
 expect(account).toMatchObject({club_id:clubId,permissions:[],roles:[],super_admin:false,clubs:[{id:foreignClubId,name:'Integration club B',roles:['owner']}]});
 // Club A through the Worker, its RPCs and RLS: nothing.
 for(const path of ['members','activity','club-settings','import-context?date=2026-10-01','admin/overview','mfa'])expect((await context.request.get(`${baseURL}/api/${path}`)).status(),path).toBe(403);
 // Being refused here does not sign them out: they still have club B.
 expect((await context.request.get(`${baseURL}/api/account`)).status()).toBe(200);
 const token=(await auth('foreign')).access_token;
 expect(await (await rest(`club_players?club_id=eq.${clubId}&select=id`,token)).json()).toEqual([]);
 expect((await (await rest('rpc/club_my_access',token,{p_club:clubId})).json()).permissions).toEqual([]);
 // A direct visit to club A's URL stays put and says so; it never switches to B or shows A's data.
 seen.length=0;await page.goto(`/members?club=${clubId}`);await expect(page).toHaveURL(`/members?club=${clubId}`);
 await expect(page.getByText('无法进入这个俱乐部')).toBeVisible();expect(seen.filter(p=>p==='/api/members')).toEqual([]);
 // An old link without a club opens their club, not the default one they cannot enter.
 await page.goto('/members');await expect(page).toHaveURL(`/members?club=${foreignClubId}`);
 // Expired access token: the refresh cookie renews the session and the account context is read again.
 await context.clearCookies({name:'__Host-club_access'});
 const renewed=await context.request.get(`${baseURL}/api/account`);expect(renewed.status()).toBe(200);expect((await renewed.json()).clubs).toHaveLength(1);
});

test('roles in A and B are listed separately, revocation removes B at once, and no-role accounts stay out',async({page,context,request})=>{
 await context.route('**/*',r=>new URL(r.request().url()).origin===baseURL?r.continue():r.abort());
 sql(`insert into public.club_memberships(club_id,user_id,role) values('${foreignClubId}','${users.admin.id}','admin') on conflict (club_id,user_id,role) do update set status='active';`);
 try{
  await signIn(page,'admin');await expect(page).toHaveURL(`/account?club=${clubId}`); // the default club, as nothing was remembered
  const clubs=async()=>(await (await context.request.get(`${baseURL}/api/account`)).json()).clubs;
  const both=await clubs();expect(both).toHaveLength(2);
  expect(both.find(c=>c.id===clubId).roles).toEqual(['admin']);expect(both.find(c=>c.id===foreignClubId)).toEqual({id:foreignClubId,name:'Integration club B',roles:['admin']});
  await expect(page.locator('.club-user-name small')).toHaveText('管理员'); // inside club A: the role there
  await page.getByRole('button',{name:/切换俱乐部/}).click();await page.getByRole('link',{name:'查看全部俱乐部 →'}).click();
  await expect(page).toHaveURL(/\/clubs$/);await expect(page.locator('.club-user-name small')).toHaveText('所属 2 个俱乐部');
  expect((await context.request.get(`${baseURL}/api/members`)).status()).toBe(200); // A business unchanged
  sql(`update public.club_memberships set status='revoked' where club_id='${foreignClubId}' and user_id='${users.admin.id}';`);
  expect((await clubs()).map(c=>c.id)).toEqual([clubId]);
 }finally{sql(`delete from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}';`);}
 // No role anywhere and not a Super Admin: sign-in is refused and the session is not kept.
 const denied=await request.post(`${baseURL}/api/login`,{headers:{Origin:baseURL},data:{email:users.outsider.email,password}});
 expect(denied.status()).toBe(403);expect(denied.headers()['set-cookie']).toMatch(/__Host-club_access=;/);
 const outsider=(await auth('outsider')).access_token;
 expect((await request.get(`${baseURL}/api/account`,{headers:{Cookie:`__Host-club_access=${outsider}`}})).status()).toBe(403);
});

test('club_my_context is callable only when signed in and only ever describes the caller',async()=>{
 // Anonymous (API key only): PostgREST refuses before the function runs.
 expect([401,403]).toContain((await rpc(null)).status);
 const token=(await auth('foreign')).access_token;
 const own=await (await rpc(token)).json();
 expect(own.clubs.map(c=>c.id)).toEqual([foreignClubId]);
 // There is no parameter to name another user or club; trying one is rejected rather than honoured.
 for(const body of [{p_user:users.owner.id},{p_club:clubId}])expect((await rpc(token,body)).status).not.toBe(200);
 const outsider=await (await rpc((await auth('outsider')).access_token)).json();
 expect(outsider).toEqual({clubs:[],super_admin:false,session_aal2:false,super_admin_active:false,platform_permissions:[]});
});
