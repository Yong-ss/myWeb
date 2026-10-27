import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { baseURL, clubId, foreignClubId, playerId, foreignPlayerId, users, password, auth, rest, state, localFetch, sql } from './local.mjs';

const member={name:'集成测试玩家',position:'正式会员',level:70,pathway:null,extraordinary_score:142,prosperity:null,weekly_activity:0,group:null,join_days:null};
const confirmation=/我已逐行核对身份/;
test.beforeEach(async({context})=>{
  // Requests go to the real Worker. Only non-local destinations are blocked.
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort('blockedbyclient'));
});
async function login(page,role='owner',allowed=true) {
  await page.goto('/login'); await page.waitForLoadState('networkidle');
  await page.getByLabel('邮箱',{exact:true}).fill(users[role].email);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  if(allowed) await expect(page.getByRole('main')).toContainText(users[role].email);
  else await expect(page.getByRole('main').getByRole('alert')).toContainText('没有访问权限');
}
async function preview(page,date,{isNew=false,upload=false}={}) {
  await page.goto('/import'); await page.waitForLoadState('networkidle');
  await page.getByLabel('实际截图日期（可补录）',{exact:true}).fill(date);
  const raw=JSON.stringify({schema_version:1,snapshot_date:null,is_complete_roster:false,members:[{...member,name:isNew?'管理员新增测试玩家':member.name}]});
  if(upload) await page.getByLabel('上传 .json（最大 128 KiB）',{exact:true}).setInputFiles({name:'real-local.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  else await page.getByLabel('JSON 原文',{exact:true}).fill(raw);
  await page.getByRole('button',{name:'校验并准备预览',exact:true}).click();
  await expect(page.getByRole('heading',{name:`${date} · 核对 1 条记录`})).toBeVisible();
  if(await page.getByLabel('第 1 行玩家身份',{exact:true}).isHidden()) await page.getByText(/查看或手动修正已匹配/).click();
  await page.getByLabel('第 1 行玩家身份',{exact:true}).selectOption(isNew?'new':playerId);
  if(await page.getByLabel('第 1 行等级',{exact:true}).isHidden()) {
    const details=page.getByText(/查看或手动修正已匹配/).locator('..');
    if(await details.getAttribute('open') === null) await page.getByText(/查看或手动修正已匹配/).click();
    await page.getByText('修正第 1 行数据',{exact:true}).click();
  }
  await page.getByLabel('第 1 行等级',{exact:true}).fill('');
  await page.getByRole('button',{name:'生成最终预览',exact:true}).click();
  await page.getByRole('checkbox',{name:confirmation}).check();
  return raw;
}
async function submit(page) {
  const pending=page.waitForRequest(r=>r.url()===baseURL+'/api/imports'&&r.method()==='POST');
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  const payload=(await pending).postDataJSON();
  await expect(page.getByRole('status')).toContainText('第 1 版');
  return payload;
}
async function token(context) { return (await context.cookies()).find(c=>c.name==='__Host-club_access').value; }
async function workerPost(context,body) { return context.request.post(baseURL+'/api/imports',{headers:{Origin:baseURL},data:body}); }
async function snapshots(date,access) {
  const r=await rest(`club_snapshots?club_id=eq.${clubId}&snapshot_date=eq.${date}&order=revision`,access);
  expect(r.status).toBe(200);return r.json();
}

test('real owner login, secure session refresh and logout revocation',async({page,context})=>{
  expect((await context.request.get(baseURL+'/api/account')).status()).toBe(401);
  await login(page);
  for(const name of ['__Host-club_access','__Host-club_refresh']) {
    const cookie=(await context.cookies()).find(c=>c.name===name);
    expect(cookie).toMatchObject({secure:true,httpOnly:true,sameSite:'Strict',domain:'127.0.0.1',path:'/'});
  }
  await context.clearCookies({name:'__Host-club_access'});
  await page.reload(); await expect(page.getByRole('main')).toContainText(users.owner.email);
  await expect.poll(async()=>Boolean((await context.cookies()).find(c=>c.name==='__Host-club_access'))).toBe(true);
  const refresh=(await context.cookies()).find(c=>c.name==='__Host-club_refresh').value;
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get(baseURL+'/api/account')).status()).toBe(401);
  const revoked=await localFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:state().anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})});
  expect(revoked.status).toBe(400);
});

test('owner upload writes real data, idempotency and concurrent stale preview protection',async({page,context})=>{
  await login(page);const date='2026-10-01';const raw=await preview(page,date,{upload:true});
  const payload=await submit(page);expect(payload.raw_text).toBe(raw);
  const access=await token(context);
  let versions=await snapshots(date,access);expect(versions).toHaveLength(1);
  const rows=await (await rest(`club_snapshot_players?snapshot_id=eq.${versions[0].id}`,access)).json();
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({player_id:playerId,level:null,weekly_activity:0,extraordinary_score:142});
  const repeated=await workerPost(context,payload);expect(repeated.status()).toBe(200);expect((await repeated.json()).replayed).toBe(true);
  expect(await snapshots(date,access)).toHaveLength(1);
  const invalid=await workerPost(context,{...payload,request_id:randomUUID(),members:[{...payload.members[0],level:'invalid'}]});expect(invalid.status()).toBe(400);
  const requests=[200,300].map(score=>workerPost(context,{...payload,request_id:randomUUID(),expected_snapshot_id:versions[0].id,members:[{...payload.members[0],extraordinary_score:score}]}));
  expect((await Promise.all(requests)).map(r=>r.status()).sort()).toEqual([200,409]);
  versions=await snapshots(date,access);expect(versions).toHaveLength(2);
  expect(versions.filter(v=>v.is_current)).toHaveLength(1);
  expect((await (await rest(`club_snapshot_players?snapshot_id=eq.${versions[0].id}`,access)).json())[0].extraordinary_score).toBe(142);
});

test('admin imports real data but cannot appoint owners; revocation is immediate',async({page,context})=>{
  await login(page,'admin');await expect(page.getByRole('main')).toContainText('管理员');
  await preview(page,'2026-10-02',{isNew:true});await submit(page);
  const access=await token(context);
  expect(await snapshots('2026-10-02',access)).toHaveLength(1);
  expect((await rest(`club_memberships?club_id=eq.${clubId}&user_id=eq.${users.admin.id}`,access,{role:'owner'},'PATCH')).status).toBe(403);
  try {
    sql(`update public.club_memberships set status='revoked' where club_id='${clubId}' and user_id='${users.admin.id}';`);
    expect((await context.request.get(baseURL+'/api/account')).status()).toBe(403);
    const stillAuthenticated=await localFetch('/auth/v1/user',{headers:{apikey:state().anonKey,Authorization:`Bearer ${access}`}});
    expect(stillAuthenticated.status).toBe(200);
    expect(await (await rest('club_players?select=id',access)).json()).toEqual([]);
  } finally { sql(`update public.club_memberships set status='active' where club_id='${clubId}' and user_id='${users.admin.id}';`); }
});

test('confirmed outsiders and owners of another club cannot enter the configured Club',async({page,context})=>{
  for(const role of ['outsider','foreign']) {
    await login(page,role,false);
    expect((await context.cookies()).some(c=>c.name==='__Host-club_access')).toBe(false);
    expect((await context.request.get(baseURL+'/api/account')).status()).toBe(401);
  }
  const settings=await (await localFetch('/auth/v1/settings',{headers:{apikey:state().anonKey}})).json();
  expect(settings.disable_signup).toBe(true);
});

test('actual REST/RPC tenant isolation and failed foreign identity rollback',async()=>{
  const owner=(await auth('owner')).access_token;
  const foreign=(await auth('foreign')).access_token;
  const outsider=(await auth('outsider')).access_token;
  expect(await (await rest(`club_players?club_id=eq.${foreignClubId}`,owner)).json()).toEqual([]);
  const otherRows=await (await rest('club_players?select=id',foreign)).json();
  expect(otherRows.map(r=>r.id)).toEqual([foreignPlayerId]);
  expect(await (await rest('club_players?select=id',outsider)).json()).toEqual([]);
  const params={p_club_id:clubId,p_date:'2026-10-03',p_complete:false,p_mode:'replace',p_rows:[{...member,name:'回滚测试玩家',player_id:null},{...member,player_id:foreignPlayerId}],p_raw:'local rollback fixture',p_request_id:randomUUID(),p_expected:null,p_confirmed:true};
  expect((await rest('rpc/club_commit_import',owner,params)).status).toBe(403);
  expect(await (await rest('club_players?display_name=eq.回滚测试玩家',owner)).json()).toEqual([]);
  expect(await snapshots('2026-10-03',owner)).toHaveLength(0);
  expect((await rest('rpc/club_commit_import',owner,{...params,p_club_id:foreignClubId,p_request_id:randomUUID()})).status).toBe(403);
});

test('real network outage recovers with the same submission id and one stored snapshot',async({page,context})=>{
  await login(page);await preview(page,'2026-10-04');
  const requests=[];page.on('request',r=>{if(r.url()===baseURL+'/api/imports'&&r.method()==='POST')requests.push(r.postDataJSON());});
  await context.setOffline(true);
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(/连接失败|Failed to fetch|NetworkError/);
  await context.setOffline(false);
  await submit(page);
  expect(requests.length).toBeGreaterThanOrEqual(2);expect(requests[0].request_id).toBe(requests.at(-1).request_id);
  expect(await snapshots('2026-10-04',await token(context))).toHaveLength(1);
});
