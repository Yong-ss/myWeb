import {test,expect} from '@playwright/test';
// Highland Race pages with mocked APIs (synthetic data). The rules themselves are enforced by the Worker and database
// (worker/highland.test.mjs, supabase/tests/club_highland.sql, tests/integration/highland.spec.mjs); here we check the
// faction-wide review: nothing is proposed beyond exact names of current members, a person resolves the rest, only this
// club's confirmed players are sent (never another club's name), and the roster must be confirmed explicitly.
const club='00000000-0000-4000-8000-000000000001',north='00000000-0000-4000-8000-0000000000a1',yi='00000000-0000-4000-8000-0000000000a2',old='00000000-0000-4000-8000-0000000000a3',ev='00000000-0000-4000-8000-0000000000e1';
const all=['audit.read','highland.edit','highland.import','highland.read','members.read'];
const account=permissions=>({email:'owner@example.invalid',club_id:club,roles:['owner'],permissions,super_admin:false,mfa_verified:false,mfa_session:false,platform_permissions:[],clubs:[{id:club,name:'松鼠俱乐部',roles:['owner']}]});
const out=(name,kills)=>({player_name:name,faction_name:'血皇帝势力',kills,assists:1,dispersals:0,awakens:0,merit:2000});
const str=(name,extra={})=>({player_name:name,faction_name:'血皇帝势力',player_damage:'1708万',damage_taken:0,healing:0,purification:0,...extra});
// A faction board: two current members, a departed member's name (could be another club's player now), a misspelling,
// other clubs' players, the pinned own row repeated, one unreadable value.
const raw=JSON.stringify({schema_version:1,event_type:'highland_race',
 output:[out('北忧',9),out('阿乙',2),out('旧人',1),out('路人甲',5),out('路人乙',3),out('北忧',9)],
 strategy:[str('路人乙'),str('阿乙',{healing:null}),str('北丶忧'),str('旧人'),str('路人丙')]});
const m=(kills,extra={})=>({kills,assists:1,dispersals:0,awakens:0,merit:2000,player_damage:17080000,damage_taken:0,healing:0,purification:0,...extra});
const detail={event:{id:ev,event_date:'2026-10-04',status:'active',version:2,total_score:3000,total_kills:11,total_merit:4000,faction:null,faction_rank:3},
 versions:[{version:2,action:'faction',created_at:'2026-10-05T01:00:00Z'},{version:1,action:'create',created_at:'2026-10-04T12:00:00Z'}],
 players:[{player_id:north,display_name:'北忧',origin:'import',output_name:'北忧',strategy_name:'北丶忧',...m(9,{merit:2846})},{player_id:yi,display_name:'阿乙',origin:'manual',output_name:null,strategy_name:null,...m(2,{merit:1154})}]};
const identities={players:[{id:north,display_name:'北忧',current:true},{id:yi,display_name:'阿乙',current:true},{id:old,display_name:'旧人',current:false}],aliases:[],can_alias:true,truncated:false,roster_date:'2026-10-03'};

async function mock(page,{perms=all,events=[],fail=[]}={}){
 const posts=[],reads=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  reads.push(url.pathname+url.search);
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  if(route.request().method()==='POST'){posts.push([url.pathname,route.request().postDataJSON(),route.request().postData()]);const f=fail.shift();return f?json({error:f[1]},f[0]):json({event_id:ev,version:3,replayed:false});}
  if(url.pathname==='/api/account')return json(account(perms));
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(url.pathname==='/api/highland-identities')return json(identities);
  if(url.pathname==='/api/highland-events')return json({events,next:null});
  if(url.pathname==='/api/highland-event')return json(url.searchParams.get('version')?{version:1,action:'create',created_at:'2026-10-04T12:00:00Z',state:{event_date:'2026-10-04',total_score:3000,status:'active',faction:'血皇帝势力',faction_rank:1,players:detail.players}}:detail);
  if(url.pathname==='/api/player-highland')return json({attended:[{event_id:ev,event_date:'2026-10-04',...m(9)}],absent:[],uncertain:3});
  if(url.pathname==='/api/player-events')return json({attended:[],absent:[],uncertain:0});
  if(url.pathname==='/api/members')return json({player:{id:north,display_name:'北忧'},timeline:[],next:null});
  return json({error:'Unknown test endpoint'},404);
 });
 return {posts,reads};
}
async function prepare(page,date='2026-10-04'){
 await page.goto(`/highland/import?club=${club}`);
 await page.getByLabel('比赛日期').fill(date);
 await page.getByLabel('本俱乐部总积分').fill('3000');
 await page.getByLabel('AI 输出的 JSON').fill(raw);
 await page.getByRole('button',{name:'开始核对'}).click();
 await expect(page.getByText('已合并 1 条完全相同的重复行')).toBeVisible();
}
const progress=page=>page.getByLabel('核对进度');

test('import: only exact names of current members are proposed; a person resolves the rest; only our players are sent',async({page})=>{
 const {posts}=await mock(page);
 await prepare(page);
 // 北忧 and 阿乙 (output) and 阿乙 (strategy) are proposed; 北丶忧 (similar) and both 旧人 rows (departed) wait.
 await expect(progress(page)).toContainText('待确认3 行');await expect(progress(page)).toContainText('拟排除4 行');
 const pending=page.getByLabel('待确认');
 await expect(pending.getByText('不在最新成员名单')).toHaveCount(2);
 await expect(pending.getByText('相似不代表是同一人')).toBeVisible();
 await expect(page.getByRole('button',{name:'核对名单并保存'})).toBeDisabled();
 // Resolve one by one: the picker moves on to the next waiting row; no new identity can be created here.
 await pending.getByRole('listitem').filter({hasText:'北丶忧'}).getByRole('button',{name:'是本俱乐部玩家'}).click();
 for(const who of ['北忧','旧人','旧人']){
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'新增玩家'})).toHaveCount(0);
  await dialog.getByRole('button',{name:new RegExp(`^${who}`)}).click();
  if(who==='旧人')await expect(dialog.getByRole('button',{name:/^旧人/})).toContainText('不在最新名单');
  await dialog.getByRole('button',{name:'确认',exact:true}).click();
 }
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(progress(page)).toContainText('拟纳入本俱乐部3 人');await expect(progress(page)).toContainText('待确认0 行');
 // 阿乙's 治疗 is unreadable: still blocked, shown as —, never 0.
 await expect(page.getByText('还有 1 名玩家的数据未识别')).toBeVisible();
 await page.getByRole('row',{name:/阿乙/}).getByRole('button',{name:'修改数据'}).click();
 await page.getByRole('dialog').getByLabel('治疗').fill('0');
 await page.getByRole('dialog').getByRole('button',{name:'确认'}).click();
 expect(posts).toEqual([]);
 // The final roster must be confirmed explicitly.
 await page.getByRole('button',{name:'核对名单并保存'}).click();
 const confirm=page.getByRole('alertdialog');
 await expect(confirm.getByLabel('本俱乐部参赛名单').getByRole('listitem')).toHaveCount(3);
 await expect(confirm).toContainText('旧人（不在最新名单）');
 await expect(confirm.getByRole('button',{name:'确认保存'})).toBeDisabled();
 await confirm.getByText(/我已核对/).click();
 await confirm.getByRole('button',{name:'确认保存'}).click();
 await expect(page).toHaveURL(/\/highland\/event\?id=/);
 const [path,body,text]=posts[0];
 expect(path).toBe('/api/highland-events');
 expect(Object.keys(body).sort()).toEqual(['event_date','faction','faction_rank','players','request_id','source','total_score']);
 expect(body).toMatchObject({event_date:'2026-10-04',total_score:3000,faction:null,faction_rank:null,source:{output_rows:5,strategy_rows:5,excluded_rows:4}});
 expect(body.players.map(p=>p.player_id).sort()).toEqual([north,yi,old].sort());
 expect(body.players.find(p=>p.player_id===north)).toMatchObject({output_name:'北忧',strategy_name:'北丶忧',kills:9,merit:2000,player_damage:17080000});
 expect(body.players.find(p=>p.player_id===yi)).toMatchObject({healing:0});
 // No other club's player and no raw board in the request.
 for(const outsider of ['路人甲','路人乙','路人丙','highland_race'])expect(text).not.toContain(outsider);
});

test('import: a player in one table only blocks; a wrongly excluded row is found and included; faction and rank are sent',async({page})=>{
 const {posts}=await mock(page);
 await prepare(page);
 await page.getByLabel('所属势力（可留空）').selectOption('血皇帝势力');await page.getByLabel('势力名次（可留空）').selectOption('2');
 // Exclude everything still waiting: 北忧 is then only in the output table.
 await page.getByRole('button',{name:'其余待确认全部排除…'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'全部排除'}).click();
 await expect(page.getByText(/「北忧」只在输出表纳入/)).toBeVisible();
 await expect(page.getByRole('button',{name:'核对名单并保存'})).toBeDisabled();
 // Find 北丶忧 among the excluded rows and include it as 北忧.
 await page.getByRole('button',{name:/拟排除 \d+ 行/}).click();
 await page.getByLabel('搜索昵称').fill('北丶忧');
 await page.getByRole('listitem').filter({hasText:'北丶忧'}).getByRole('button',{name:'是本俱乐部玩家'}).click();
 await page.getByRole('dialog').getByRole('button',{name:/^北忧/}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.getByText(/只在输出表纳入/)).toHaveCount(0);
 await page.getByRole('row',{name:/阿乙/}).getByRole('button',{name:'修改数据'}).click();
 await page.getByRole('dialog').getByLabel('治疗').fill('0');await page.getByRole('dialog').getByRole('button',{name:'确认'}).click();
 await page.getByRole('button',{name:'核对名单并保存'}).click();
 const confirm=page.getByRole('alertdialog');await confirm.getByText(/我已核对/).click();await confirm.getByRole('button',{name:'确认保存'}).click();
 await expect.poll(()=>posts.length).toBe(1);
 expect(posts[0][1]).toMatchObject({faction:'血皇帝势力',faction_rank:2});
 expect(posts[0][1].players).toHaveLength(2);
});

test('import: an existing highland date and a four-way JSON are refused before review',async({page})=>{
 const first=await mock(page,{events:[{id:ev,event_date:'2026-10-04'}]});
 await page.goto(`/highland/import?club=${club}`);
 await page.getByLabel('比赛日期').fill('2026-10-04');await page.getByLabel('本俱乐部总积分').fill('1');await page.getByLabel('AI 输出的 JSON').fill(raw);
 await page.getByRole('button',{name:'开始核对'}).click();
 await expect(page.locator('#highland-import-error')).toContainText('2026-10-04 已有高原竞逐记录');
 expect(first.posts).toEqual([]);
 // A four-way JSON is refused with a clear message.
 await page.getByLabel('比赛日期').fill('2026-10-05');
 await page.getByLabel('AI 输出的 JSON').fill(JSON.stringify({schema_version:1,event_type:'four_way_league',output:[],strategy:[]}));
 await page.getByRole('button',{name:'开始核对'}).click();
 await expect(page.locator('#highland-import-error')).toContainText('需要高原竞逐 V1 JSON');
});

test('import: without highland.import (even with every four-way permission) the page explains and sends nothing',async({page})=>{
 const {reads}=await mock(page,{perms:['events.edit','events.import','events.read','highland.read','members.read']});
 await page.goto(`/highland/import?club=${club}`);
 await expect(page.getByText('没有导入高原竞逐的权限')).toBeVisible();
 expect(reads.some(r=>r.startsWith('/api/highland-identities'))).toBe(false);
});

test('detail: faction and rank are edited with the version the editor saw; versions show the faction history',async({page})=>{
 const {posts}=await mock(page);
 await page.goto(`/highland/event?club=${club}&id=${ev}`);
 await expect(page.getByRole('heading',{name:'高原竞逐 · 2026-10-04'})).toBeVisible();
 await expect(page.getByText('第 3 名')).toBeVisible();
 const names=()=>page.getByRole('tabpanel').locator('tbody tr td:first-child a').allTextContents();
 expect(await names()).toEqual(['北忧','阿乙']); // merit, high to low
 await page.getByRole('tab',{name:'战略'}).click();
 await expect(page.getByRole('tabpanel').getByRole('button',{name:/对守卫伤害/})).toHaveCount(0);
 await page.getByRole('button',{name:'修改势力／名次'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'确认保存'})).toBeDisabled(); // no change yet
 await dialog.getByLabel('所属势力').selectOption('血皇帝势力');await dialog.getByLabel('势力名次').selectOption('');
 await dialog.getByRole('button',{name:'确认保存'}).click();
 await expect.poll(()=>posts.length).toBe(1);
 expect(posts[0][1]).toMatchObject({event_id:ev,expected_version:2,action:'faction',payload:{faction:'血皇帝势力',faction_rank:null}});
 await page.getByRole('button',{name:/修改历史/}).click();
 await page.getByRole('listitem').filter({hasText:'第 1 版'}).getByRole('button',{name:'查看'}).click();
 await expect(page.getByRole('dialog')).toContainText('势力 血皇帝势力 · 名次 第 1 名');
});

test('detail: a read-only viewer (alliance leader) sees results without edit actions',async({page})=>{
 await mock(page,{perms:['audit.read','highland.read','members.read']});
 await page.goto(`/highland/event?club=${club}&id=${ev}`);
 await expect(page.getByRole('heading',{name:'高原竞逐 · 2026-10-04'})).toBeVisible();
 for(const name of ['修改势力／名次','修改总积分','作废整场','补录玩家','修改数据','移除本场记录'])await expect(page.getByRole('button',{name})).toHaveCount(0);
});

test('profile and navigation: highland attendance and entry follow highland.read only, separate from the four-way ones',async({page})=>{
 const {reads}=await mock(page,{perms:['highland.read','members.read']});
 await page.goto(`/players?club=${club}&id=${north}`);
 await expect(page.getByRole('link',{name:/高原竞逐/})).toBeVisible();
 await expect(page.getByRole('link',{name:/四方联赛/})).toHaveCount(0);
 await page.getByRole('button',{name:'参加 1 场'}).click();
 await expect(page.getByRole('dialog').getByRole('columnheader',{name:'战功'})).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('link',{name:'2026-10-04'})).toHaveAttribute('href',new RegExp(`/highland/event\\?id=${ev}&player=${north}`));
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'缺席 0 场'}).click();
 await expect(page.getByRole('dialog')).toContainText('另有 3 场');
 expect(reads.some(r=>r.startsWith('/api/player-events'))).toBe(false);
 const other=await mock(page,{perms:['events.read','members.read']});
 await page.goto(`/players?club=${club}&id=${north}`);
 await expect(page.getByRole('heading',{name:'北忧'})).toBeVisible();
 await expect(page.getByRole('link',{name:/高原竞逐/})).toHaveCount(0);
 expect(other.reads.some(r=>r.startsWith('/api/player-highland'))).toBe(false);
});

// Visual review (desktop and phone): every highland page fits the viewport; screenshots are inspected by a person.
for(const width of [1440,390])test(`highland pages fit and are captured at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await mock(page,{events:[{id:ev,event_date:'2026-10-04',status:'active',version:2,total_score:3000,faction:'血皇帝势力',faction_rank:1,participants:2,total_kills:11,total_merit:4000}]});
 for(const [name,path] of [['highland',`/highland?club=${club}`],['highland-event',`/highland/event?club=${club}&id=${ev}`]]){
  await page.goto(path);await page.waitForLoadState('networkidle');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must fit`).toBe(true);
  await page.screenshot({path:`.test-artifacts/club-review/${name}-${width}.png`,fullPage:true});
 }
 await prepare(page,'2026-10-05');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'import must fit').toBe(true);
 await page.screenshot({path:`.test-artifacts/club-review/highland-import-${width}.png`,fullPage:true});
});
