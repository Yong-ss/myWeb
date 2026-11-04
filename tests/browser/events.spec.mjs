import {test,expect} from '@playwright/test';
// Four-Way League pages with mocked APIs (synthetic data). The rules themselves are enforced by the Worker and database
// (worker/events.test.mjs, supabase/tests/club_events.sql, tests/integration/events.spec.mjs); here we check that the
// operator can only save a strict two-table result, that nothing is sent before confirmation, and what each role sees.
const club='00000000-0000-4000-8000-000000000001',north='00000000-0000-4000-8000-0000000000a1',yi='00000000-0000-4000-8000-0000000000a2',ev='00000000-0000-4000-8000-0000000000e1';
const all=['audit.read','events.edit','events.import','events.read','members.read'];
const account=permissions=>({email:'owner@example.invalid',club_id:club,roles:['owner'],permissions,super_admin:false,mfa_verified:false,mfa_session:false,platform_permissions:[],clubs:[{id:club,name:'松鼠俱乐部',roles:['owner']}]});
const out=(name,kills)=>({player_name:name,club_name:'千秋｜君辞赋',kills,assists:1,dispersals:0,awakens:0});
const str=(name,extra={})=>({player_name:name,club_name:'千秋｜君辞赋',player_damage:100,damage_taken:0,healing:0,guardian_damage:0,purification:0,...extra});
// Pinned own row repeated in 输出, 战略 in another order, one misspelled name, one 万 value, one unreadable value, one new player.
const raw=JSON.stringify({schema_version:1,event_type:'four_way_league',output:[out('北忧',9),out('阿乙',2),out('新人',0),out('北忧',9)],strategy:[str('新人'),str('阿乙',{player_damage:'50.1万',healing:null}),str('北丶忧')]});
const m=(kills,extra={})=>({kills,assists:1,dispersals:0,awakens:0,player_damage:100,damage_taken:0,healing:0,guardian_damage:0,purification:0,...extra});
const detail=(raw_text='{"raw":true}')=>({event:{id:ev,event_date:'2026-10-04',status:'active',version:3,total_score:3000,total_kills:11},versions:[{version:3,action:'score',created_at:'2026-10-05T01:00:00Z'},{version:1,action:'create',created_at:'2026-10-04T12:00:00Z'}],raw_text,
 players:[{player_id:north,display_name:'北忧',origin:'import',output_name:'北忧',strategy_name:'北丶忧',...m(9)},{player_id:yi,display_name:'阿乙',origin:'manual',output_name:null,strategy_name:null,...m(2,{player_damage:501000})}]});

async function mock(page,{perms=all,events=[],fail=[],detailBody=detail()}={}){
 const posts=[],reads=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  reads.push(url.pathname+url.search);
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  if(route.request().method()==='POST'){posts.push([url.pathname,route.request().postDataJSON()]);const f=fail.shift();return f?json({error:f[1]},f[0]):json({event_id:ev,version:4,replayed:false});}
  if(url.pathname==='/api/account')return json(account(perms));
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(url.pathname==='/api/event-identities')return json({players:[{id:north,display_name:'北忧'},{id:yi,display_name:'阿乙'}],aliases:[],can_alias:true});
  if(url.pathname==='/api/events')return json({events,next:null});
  if(url.pathname==='/api/event')return json(detailBody);
  if(url.pathname==='/api/player-events')return json({attended:[{event_id:ev,event_date:'2026-10-04',...m(9)}],absent:[{event_id:'00000000-0000-4000-8000-0000000000e2',event_date:'2026-10-01'}],uncertain:2});
  if(url.pathname==='/api/members')return json({player:{id:north,display_name:'北忧'},timeline:[],next:null});
  return json({error:'Unknown test endpoint'},404);
 });
 return {posts,reads};
}
async function prepare(page,date='2026-10-04'){
 await page.goto(`/events/import?club=${club}`);
 await page.getByLabel('比赛日期').fill(date);
 await page.getByLabel('本俱乐部总积分').fill('3000');
 await page.getByLabel('AI 输出的 JSON').fill(raw);
 await page.getByRole('button',{name:'开始核对'}).click();
 await expect(page.getByText('已合并 1 条完全相同的重复行')).toBeVisible();
}
// Confirms every unresolved row: the misspelling is 北忧, the newcomer is a new player in both tables.
async function resolve(page){
 await page.getByRole('button',{name:'确认身份'}).first().click();
 for(let i=0;i<3;i++){
  const dialog=page.getByRole('dialog');
  const misspelled=await dialog.getByText('北丶忧').isVisible();
  if(misspelled){await dialog.getByRole('button',{name:'选择已有玩家'}).click();await dialog.getByRole('button',{name:/^北忧/}).click();}
  else await dialog.getByRole('button',{name:'新增玩家'}).click();
  await dialog.getByRole('button',{name:'确认',exact:true}).click();
 }
 await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('import: two tables join by identity, gaps block saving, nothing is sent before confirmation',async({page})=>{
 const {posts}=await mock(page);
 await prepare(page);
 await expect(page.getByText('战略第 3 行「北丶忧」尚未确认身份')).toBeVisible();
 await expect(page.getByText(/「北忧」只出现在输出表/)).toBeVisible();
 await expect(page.getByRole('button',{name:'确认并保存'})).toBeDisabled();
 await resolve(page);
 await expect(page.getByLabel('需要处理的问题')).toHaveCount(0);
 // 阿乙's 治疗 was unreadable: still blocked, and the gap is shown as —, never 0.
 await expect(page.getByText('还有 1 名玩家的数据未识别')).toBeVisible();
 await expect(page.getByRole('button',{name:'确认并保存'})).toBeDisabled();
 await page.getByRole('row',{name:/阿乙/}).getByRole('button',{name:'修改数据'}).click();
 await page.getByRole('dialog').getByLabel('治疗').fill('0');
 await page.getByRole('dialog').getByRole('button',{name:'确认'}).click();
 await expect(page.getByText(/总击杀（个人击败合计）11/)).toBeVisible();
 expect(posts).toEqual([]);
 await page.getByRole('button',{name:'确认并保存'}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'确认保存'}).click();
 await expect(page).toHaveURL(/\/event\?id=/);
 const [path,body]=posts[0];
 expect(path).toBe('/api/events');
 expect(body.raw_text).toBe(raw);expect(body.event_date).toBe('2026-10-04');expect(body.total_score).toBe(3000);
 expect(body.players).toHaveLength(3);
 const byName=Object.fromEntries(body.players.map(p=>[p.name??p.player_id,p]));
 expect(byName[yi]).toMatchObject({player_damage:501000,healing:0,kills:2});
 expect(byName[north]).toMatchObject({output_name:'北忧',strategy_name:'北丶忧',kills:9});
 expect(byName['新人']).toMatchObject({player_id:null,kills:0});
});

test('import: a failed save retries with the same request id; an existing date is refused before review',async({page})=>{
 const {posts}=await mock(page,{fail:[[502,'连接失败']]});
 await prepare(page);await resolve(page);
 await page.getByRole('row',{name:/阿乙/}).getByRole('button',{name:'修改数据'}).click();
 await page.getByRole('dialog').getByLabel('治疗').fill('0');await page.getByRole('dialog').getByRole('button',{name:'确认'}).click();
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'确认并保存'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认保存'}).click();if(!i)await expect(page.locator('#event-import-error')).toContainText('同一份内容只会保存一次');}
 await expect(page).toHaveURL(/\/event\?id=/);
 expect(posts[0][1].request_id).toBe(posts[1][1].request_id);
 const second=await mock(page,{events:[{id:ev,event_date:'2026-10-04'}]});
 await page.goto(`/events/import?club=${club}`);
 await page.getByLabel('比赛日期').fill('2026-10-04');await page.getByLabel('本俱乐部总积分').fill('1');await page.getByLabel('AI 输出的 JSON').fill(raw);
 await page.getByRole('button',{name:'开始核对'}).click();
 await expect(page.locator('#event-import-error')).toContainText('2026-10-04 已有四方联赛记录');
 expect(second.posts).toEqual([]);
});

test('detail: two views of one player list, sorting is display only, removal needs explicit confirmation',async({page})=>{
 const {posts}=await mock(page);
 await page.goto(`/event?club=${club}&id=${ev}`);
 await expect(page.getByText('总击杀（个人击败合计）')).toBeVisible();
 await expect(page.getByText('人工补录')).toBeVisible();
 const names=()=>page.getByRole('tabpanel').locator('tbody tr td:first-child a').allTextContents();
 expect(await names()).toEqual(['北忧','阿乙']); // kills, high to low
 await page.getByRole('tabpanel').getByRole('button',{name:/击败/}).click();
 expect(await names()).toEqual(['阿乙','北忧']);
 await page.getByRole('tab',{name:'战略'}).click();
 await expect(page.getByRole('tabpanel').getByText('501000')).toBeVisible();
 await page.getByRole('tabpanel').getByRole('row',{name:/阿乙/}).getByRole('button',{name:'移除本场记录'}).click();
 const confirm=page.getByRole('alertdialog');
 await expect(confirm).toContainText('不删除玩家档案');
 expect(posts).toEqual([]);
 await confirm.getByRole('button',{name:'确认移除'}).click();
 await expect.poll(()=>posts.length).toBe(1);
 expect(posts[0][1]).toMatchObject({event_id:ev,expected_version:3,action:'remove',payload:{player_id:yi}});
 await expect(page.getByText('原始 AI JSON（仅本俱乐部可见）')).toBeVisible();
});

test('detail: a read-only viewer (alliance leader) sees results without edit actions or the raw JSON',async({page})=>{
 await mock(page,{perms:['audit.read','events.read','members.read'],detailBody:detail(null)});
 await page.goto(`/event?club=${club}&id=${ev}`);
 await expect(page.getByRole('heading',{name:'四方联赛 · 2026-10-04'})).toBeVisible();
 for(const name of ['修改总积分','作废整场','补录玩家','修改数据','移除本场记录'])await expect(page.getByRole('button',{name})).toHaveCount(0);
 await expect(page.getByText('原始 AI JSON')).toHaveCount(0);
});

test('profile: attendance numbers open their lists; an old date link no longer cuts the history',async({page})=>{
 const {reads}=await mock(page);
 await page.goto(`/players?club=${club}&id=${north}&date=2026-10-01`);
 await page.getByRole('button',{name:'参加 1 场'}).click();
 const list=page.getByRole('dialog');
 await expect(list.getByRole('link',{name:'2026-10-04'})).toHaveAttribute('href',new RegExp(`/event\\?id=${ev}&player=${north}`));
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'缺席 1 场'}).click();
 await expect(page.getByRole('dialog')).toContainText('另有 2 场');
 await expect(page.getByRole('dialog').getByText('击败')).toHaveCount(0); // no invented results for an absence
 expect(reads.filter(r=>r.startsWith('/api/members')).every(r=>!r.includes('date='))).toBe(true);
});

test('without events.read there is no sidebar entry and no attendance card',async({page})=>{
 const {reads}=await mock(page,{perms:['members.read']});
 await page.goto(`/players?club=${club}&id=${north}`);
 await expect(page.getByRole('heading',{name:'北忧'})).toBeVisible();
 await expect(page.getByRole('link',{name:/四方联赛/})).toHaveCount(0);
 await expect(page.getByText('参加',{exact:false})).toHaveCount(0);
 expect(reads.some(r=>r.startsWith('/api/player-events'))).toBe(false);
});

// Visual review (desktop and phone): every event page fits the viewport; screenshots are inspected by a person.
for(const width of [1440,390])test(`event pages fit and are captured at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await mock(page,{events:[{id:ev,event_date:'2026-10-04',status:'active',version:3,total_score:3000,participants:2,total_kills:11}]});
 const shots=[['events',`/events?club=${club}`],['event',`/event?club=${club}&id=${ev}`],['profile',`/players?club=${club}&id=${north}`]];
 for(const [name,path] of shots){
  await page.goto(path);await page.waitForLoadState('networkidle');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must fit`).toBe(true);
  await page.screenshot({path:`.test-artifacts/club-review/${name}-${width}.png`,fullPage:true});
 }
 await prepare(page,'2026-10-05');await resolve(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'import must fit').toBe(true);
 await page.screenshot({path:`.test-artifacts/club-review/event-import-${width}.png`,fullPage:true});
});
