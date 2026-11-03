import {test,expect} from '@playwright/test';
import {auth,rest,sql,localFetch,state,totp,clubId,foreignClubId,playerId,foreignPlayerId,baseURL,users,password} from './local.mjs';
// Stage D on real Supabase + Worker: the club comes from each request (?club=), and the Worker and the database
// (club_my_access, can(), RLS, RPCs) decide access to that club only. Club A is the Worker's default club; B is not.
const authApi=(path,token,body)=>localFetch(`/auth/v1/${path}`,{method:'POST',headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const cookie=token=>({Cookie:`__Host-club_access=${token}`});
const history=(club,player)=>`members?player=${player}&paged=1&club=${club}`;

test('each club is authorized on its own: reads, writes, cross-club refusals, and the Super Admin',async({request})=>{
 test.setTimeout(90000);
 const get=(path,token)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(token)});
 const post=(path,token,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(token),Origin:baseURL},data});
 sql(`insert into public.club_memberships(club_id,user_id,role) values('${foreignClubId}','${users.admin.id}','admin') on conflict (club_id,user_id,role) do update set status='active';`);
 const name=club=>sql(`select name from public.club_clubs where id='${club}';`);
 const before=name(foreignClubId);
 let factor;
 try{
  const admin=(await auth('admin')).access_token,foreign=(await auth('foreign')).access_token;
  // One account, two clubs: each answer is that club's data, under that club's cache scope.
  for(const [club,player,other] of [[clubId,playerId,foreignPlayerId],[foreignClubId,foreignPlayerId,playerId]]){
   const own=await get(history(club,player),admin);expect(own.status(),club).toBe(200);
   expect(own.headers()['x-club-scope']).toContain(`:${club}:`);
   expect((await own.json()).player.id).toBe(player);
   expect((await get(history(club,other),admin)).status(),'another club\'s player through this club').not.toBe(200);
   expect((await (await get(`account?club=${club}`,admin)).json()).club_id).toBe(club);
  }
  // Owner of B only: club A is refused through every route kind, and B's id in the body changes nothing.
  for(const path of [`members?club=${clubId}`,`team?club=${clubId}`,`activity?club=${clubId}`,`club-settings?club=${clubId}`,`import-context?date=2026-10-01&club=${clubId}`])
   expect((await get(path,foreign)).status(),path).toBe(403);
  const roleWrite={user_id:users.admin.id,action:'revoke',expected_version:0,request_id:crypto.randomUUID()};
  expect((await post(`team/role?club=${clubId}`,foreign,roleWrite)).status()).toBe(403);
  expect((await post(`team/role?club=${foreignClubId}`,foreign,{...roleWrite,club_id:clubId})).status()).toBe(400);
  expect(sql(`select status from public.club_memberships where club_id='${clubId}' and user_id='${users.admin.id}' and role='admin';`)).toBe('active');
  expect((await post(`club-settings?club=${clubId}`,foreign,{name:'被改名',expected_name:name(clubId)})).status()).toBe(403);
  // Their own club works in the same session: owner tools and a write, landing in B only.
  const team=await get(`team?club=${foreignClubId}`,foreign);expect(team.status()).toBe(200);
  expect(JSON.stringify(await team.json())).toContain(users.admin.id);
  const nameA=name(clubId);
  expect((await post(`club-settings?club=${foreignClubId}`,foreign,{name:'Integration club B renamed',expected_name:before})).status()).toBe(200);
  expect(name(foreignClubId)).toBe('Integration club B renamed');expect(name(clubId)).toBe(nameA);
  expect(sql(`select count(*) from public.club_audit_events where club_id='${foreignClubId}' and action='club_renamed' and actor_id='${users.foreign.id}';`)).not.toBe('0');
  // Admin in B: owner-only tools stay refused there, exactly as in A.
  expect((await get(`team?club=${foreignClubId}`,admin)).status()).toBe(403);
  // Malformed and unknown clubs: refused, never answered by the default club.
  expect((await get('members?club=not-a-club',admin)).status()).toBe(400);
  expect((await get(`members?club=${crypto.randomUUID()}`,admin)).status()).toBe(403);
  // Super Admin (owner of A, no role in B): B is closed with a password-only session and opens with trusted MFA.
  const aal1=(await auth('owner')).access_token;
  expect((await get(history(foreignClubId,foreignPlayerId),aal1)).status()).toBe(403);
  factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'Multi-club integration'})).json();
  const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  const aal2=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json()).access_token;
  sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  expect((await (await get(history(foreignClubId,foreignPlayerId),aal2)).json()).player.id).toBe(foreignPlayerId);
  const overview=await (await get('admin/overview',aal2)).json();
  expect(overview.clubs.map(c=>c.id)).toEqual(expect.arrayContaining([clubId,foreignClubId]));
 }finally{
  sql(`update public.club_clubs set name='${before.replaceAll("'","''")}' where id='${foreignClubId}';
   delete from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}';${factor?.id?`delete from auth.mfa_factors where id='${factor.id}';`:''}`);
 }
});

test('two tabs on two clubs stay apart; the switcher, reloads and the remembered club only move one tab',async({browser})=>{
 sql(`insert into public.club_memberships(club_id,user_id,role) values('${foreignClubId}','${users.admin.id}','admin') on conflict (club_id,user_id,role) do update set status='active';`);
 const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true});
 try{
  await context.route('**/*',r=>new URL(r.request().url()).origin===baseURL?r.continue():r.abort());
  const a=await context.newPage(),calls=[];
  a.on('request',r=>{const u=new URL(r.url());if(/^\/api\/(members|club-settings|activity|team)/.test(u.pathname))calls.push(u.searchParams.get('club'));});
  await a.goto('/login');await a.getByLabel('邮箱',{exact:true}).fill(users.admin.email);await a.getByLabel('密码',{exact:true}).fill(password);
  await a.getByRole('button',{name:'登录',exact:true}).click();await expect(a).toHaveURL(`/account?club=${clubId}`);
  const b=await context.newPage();await b.goto(`/players?id=${foreignPlayerId}&club=${foreignClubId}`);
  await expect(b.getByRole('heading',{name:'其他俱乐部玩家'})).toBeVisible();await expect(b.locator('.club-brand-name')).toHaveText('Integration club B');
  await a.bringToFront();await a.goto(`/players?id=${playerId}&club=${clubId}`);await expect(a.getByRole('heading',{name:'集成测试玩家'})).toBeVisible();
  // Switching tab A to B leaves the other tab's club and page alone.
  await a.getByRole('button',{name:/切换俱乐部/}).click();await a.getByRole('navigation',{name:'选择俱乐部'}).getByRole('link',{name:/Integration club B/}).click();
  await expect(a).toHaveURL(`/members?club=${foreignClubId}`);await expect(a.locator('.club-brand-name')).toHaveText('Integration club B');
  await b.reload();await expect(b.getByRole('heading',{name:'其他俱乐部玩家'})).toBeVisible();
  // The last club entered (B) is the next sign-in's start, but only while the account can still enter it.
  const c=await context.newPage();await c.goto('/login');await expect(c).toHaveURL(`/account?club=${foreignClubId}`);
  sql(`update public.club_memberships set status='revoked' where club_id='${foreignClubId}' and user_id='${users.admin.id}';`);
  await c.goto('/login');await expect(c).toHaveURL(`/account?club=${clubId}`);
  // Revoked in B: the open B tab says so on its next page, without falling back to A.
  await b.bringToFront();await b.goto(`/members?club=${foreignClubId}`);await expect(b.getByText('无法进入这个俱乐部')).toBeVisible();
  await expect(b).toHaveURL(`/members?club=${foreignClubId}`);
  expect(calls.every(club=>club===clubId||club===foreignClubId),JSON.stringify(calls)).toBe(true);
 }finally{
  sql(`delete from public.club_memberships where club_id='${foreignClubId}' and user_id='${users.admin.id}';`);
  await context.close();
 }
});
