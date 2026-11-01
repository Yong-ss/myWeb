import {test,expect} from '@playwright/test';
// Platform panel UI with mocked APIs. Access itself is enforced by the Worker and database (see worker/admin.test.mjs,
// supabase/tests/platform_admin.sql and tests/integration/admin.spec.mjs); here we check what each account is shown.
const club='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-0000000000aa';
const account=platform=>({email:'boss@example.invalid',club_id:club,roles:['owner'],permissions:['members.read'],super_admin:true,mfa_verified:platform,mfa_session:platform,platform_permissions:platform?['platform.read']:[]});
const overview={totals:{clubs:2,users:5,confirmed_users:4,members:3,active_roles:4},alliances:null,clubs:[{id:club,name:'松鼠俱乐部',members:2,players:86,latest_snapshot:'2026-10-30',is_complete_roster:false,player_counts:{present:64,temporary:3,confirmed_left:8,unconfirmed:7,other_left:4}},{id:uid,name:'第二俱乐部',members:1,players:0,latest_snapshot:null,player_counts:null}]};
const user=(email,extra={})=>({id:uid,email,email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,super_admin:false,memberships:[{club_id:club,club_name:'松鼠俱乐部',role:'admin',role_name:'管理员',status:'active'}],effective:[{club_id:club,club_name:'松鼠俱乐部',permissions:['audit.read','members.read']}],...extra});
const roles={permissions:[{key:'members.read',kind:'action',scopes:['platform','alliance','club'],sensitive:false,description:'查看成员名单'},{key:'club.rename',kind:'action',scopes:['club'],sensitive:false,description:'修改俱乐部名称'}],roles:[{key:'owner',name:'公会长',scope:'club',club_name:null,system:true,permissions:['club.rename','members.read'],assigned:1},{key:'admin',name:'管理员',scope:'club',club_name:null,system:true,permissions:['members.read'],assigned:2}]};
const activity={events:[{id:uid,created_at:'2026-10-30T12:00:00Z',action:'club_memberships.update',via:'authenticator',actor:'boss@example.invalid',subject:'manager@example.invalid',club:'松鼠俱乐部',details:{old:{role:'admin',status:'active'},new:{role:'admin',status:'revoked'}}},{id:club,created_at:'2026-10-29T12:00:00Z',action:'platform_super_admin_factors.insert',via:'postgres',actor:null,subject:'boss@example.invalid',club:null,details:{new:{factor_name:'手机'}}}],next:null};

async function mock(page,platform,data=overview,write=false){
 const seen=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  seen.push(url.pathname+url.search);
  const json=body=>route.fulfill({json:body,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/account')return json({...account(platform),platform_permissions:platform?['platform.read',...(write?['platform.roles.assign']:[])]:[]});
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(!platform&&url.pathname.startsWith('/api/admin/'))return route.fulfill({status:403,json:{error:'需要已完成两步验证、并使用已确认设备登录的超级管理员'}});
  if(url.pathname==='/api/admin/overview')return json(data);
  if(url.pathname==='/api/admin/users')return json({users:url.searchParams.get('q')?[user('manager@example.invalid')]:[user('manager@example.invalid'),user('boss@example.invalid',{id:club,super_admin:true,memberships:[],effective:[]})],next:null});
  if(url.pathname==='/api/admin/roles')return json(roles);
  if(url.pathname==='/api/admin/activity')return json(activity);
  return route.fulfill({status:404,json:{error:'Unknown test endpoint'}});
 });
 return seen;
}

test('a Super Admin before MFA sees both identities, MFA guidance and no platform data',async({page})=>{
 const seen=await mock(page,false);
 await page.goto('/account');await expect(page.locator('.club-header-account')).toContainText('超级管理员（待两步验证） · 公会长');
 await page.getByRole('link',{name:'平台管理中心'}).click();await expect(page).toHaveURL(/\/admin$/);
 await expect(page.getByRole('heading',{name:'请完成两步验证'})).toBeVisible();
 await expect(page.getByRole('link',{name:'前往两步验证'})).toHaveAttribute('href','/admin/security');
 await expect(page.locator('.club-header-settings')).toHaveText('账户安全');await expect(page.locator('.club-header-settings')).toHaveAttribute('href','/admin/security');
 await expect(page.locator('.club-brand-subtitle')).toHaveText('平台管理中心');
 // The page never even asks for platform data when the account has no platform permission.
 expect(seen.filter(p=>p.startsWith('/api/admin/'))).toEqual([]);
});

for(const width of [1440,390,320])test(`the active Super Admin reads overview, users, roles and the platform log ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const seen=await mock(page,true);
 await page.goto('/account');await page.getByRole('link',{name:'平台管理中心'}).click();
 await expect(page).toHaveURL(/\/admin$/);await expect(page.getByRole('heading',{name:'平台管理中心',level:1})).toBeVisible();
 // Only the club this deployment serves can be entered; the other is honestly marked as not yet available.
 await expect(page.getByRole('link',{name:'进入管理松鼠俱乐部'})).toHaveAttribute('href','/account');
 await expect(page.getByRole('link',{name:'进入管理第二俱乐部'})).toHaveCount(0);await expect(page.getByText('暂未开放')).toHaveCount(1);
 await expect(page.getByRole('link',{name:'俱乐部工作空间'})).toHaveAttribute('href','/account');
 // Overview: real counts, and alliances are reported as not enabled rather than a made-up zero.
 await expect(page.getByText('未启用',{exact:true})).toBeVisible();await expect(page.getByText('4 个已验证邮箱')).toBeVisible();
 const row=page.getByRole('row',{name:/松鼠俱乐部/});
 await expect(page.getByRole('columnheader',{name:'当前在会人数'})).toBeAttached();
 await expect(row.locator('strong')).toHaveText('64');
 await expect(row).toContainText('历史累计玩家：86');
 await expect(row).toContainText('不完整名单');
 const empty=page.getByRole('row',{name:/第二俱乐部/});
 await expect(empty.locator('strong')).toHaveText('暂无数据');
 await expect(row.getByText('暂离人数',{exact:true})).toHaveCount(0);
 const toggle=page.getByRole('button',{name:'松鼠俱乐部人数详情'});
 await toggle.focus();await page.keyboard.press('Enter');
 await expect(toggle).toHaveAttribute('aria-expanded','true');
 for(const [label,n] of [['暂离人数',3],['已确认退会人数',8],['待确认人数',7],['其他不在会人数',4]])await expect(row.getByText(label,{exact:true}).locator('..').locator('dd')).toHaveText(String(n));
 await expect(row.locator('[data-slot="collapsible-content"] > div')).toHaveCSS('opacity','1');
 expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(width<640)expect(await row.locator('td').last().evaluate(el=>el.clientWidth)).toBeGreaterThan(width-80);
 expect(await page.locator('caption').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(100);
 await page.screenshot({path:`.test-artifacts/admin-overview-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','false');
 await expect(row.getByText('暂离人数',{exact:true})).toHaveCount(0);
 await empty.getByRole('button').click();
 await expect(empty.locator('dd')).toHaveText(['暂无数据','暂无数据','暂无数据','暂无数据']);
 await page.getByRole('tab',{name:'用户与角色'}).click();
 await expect(page.getByRole('row',{name:/manager@example\.invalid/})).toContainText('松鼠俱乐部 · 管理员');
 await expect(page.getByRole('row',{name:/boss@example\.invalid/})).toContainText('仅在两步验证后拥有全部权限');
 await page.getByLabel('搜索用户').fill(' manager ');await page.getByRole('button',{name:'搜索',exact:true}).click();
 await expect(page.getByRole('row',{name:/boss@example\.invalid/})).toHaveCount(0);
 expect(seen).toContain('/api/admin/users?q=manager');
 await page.getByRole('tab',{name:'角色与权限'}).click();
 const rename=page.getByRole('row',{name:/修改俱乐部名称/});
 await expect(rename.getByText('公会长拥有')).toBeAttached();await expect(rename.getByText('管理员没有')).toBeAttached();
 await page.getByRole('tab',{name:'平台日志'}).click();
 await expect(page.getByRole('row',{name:/修改 · 俱乐部角色/})).toContainText('status: active → revoked');
 await expect(page.getByRole('row',{name:/新增 · 超级管理员验证器/})).toContainText('Supabase SQL Editor／迁移');
 await page.screenshot({path:`.test-artifacts/admin-activity-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Read-only phase: no write controls anywhere in the panel.
 await expect(page.getByRole('button',{name:/任命|撤销|编辑|保存|删除/})).toHaveCount(0);
});

test('zero is real data and an older overview response never substitutes historical players for current members',async({page})=>{
 await mock(page,true,{...overview,clubs:[{...overview.clubs[0],player_counts:{present:0,temporary:0,confirmed_left:0,unconfirmed:86,other_left:0}},{id:uid,name:'旧统计响应',members:1,players:86,latest_snapshot:'2026-10-30'}]});
 await page.goto('/admin');
 await expect(page.getByRole('row',{name:/松鼠俱乐部/}).locator('strong')).toHaveText('0');
 await expect(page.getByRole('row',{name:/旧统计响应/}).locator('strong')).toHaveText('暂无数据');
});

for(const width of [1440,390,320])test(`role assignments identify the account and club, revoke and restore with refreshed status ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page,true,overview,true);
 let version=0,status='active';const writes=[];
 await page.route('**/api/admin/users?*',route=>route.fulfill({json:{users:[user('manager@example.invalid',{memberships:[{club_id:club,club_name:'松鼠俱乐部',role:'admin',role_name:'管理员',status}],effective:status==='active'?[{club_id:club,club_name:'松鼠俱乐部',permissions:['members.read']}]:[]})],next:null}}));
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,role_version:version,owner_id:club},{id:uid,name:'第二俱乐部',admin_limit:5,role_version:0,owner_id:null}],memberships:[{club_id:club,role:'admin',status}]}}));
 await page.route('**/api/admin/assign-role',route=>{const body=route.request().postDataJSON();writes.push(body);status=body.action==='revoke'?'revoked':'active';version++;return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();
 await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('网站账户：manager@example.invalid');await expect(dialog.getByRole('button',{name:'任命角色',exact:true})).toBeDisabled();
 await dialog.getByLabel('目标俱乐部').selectOption(club);await expect(dialog).toContainText('当前状态：生效中');
 await dialog.getByRole('button',{name:'撤销角色',exact:true}).click();await expect(dialog).toContainText('俱乐部：松鼠俱乐部');await expect(dialog).toContainText('角色：管理员');
 await expect(dialog.getByText('此角色授予的权限将立即失效',{exact:false})).toBeVisible();
 await page.screenshot({path:`.test-artifacts/admin-role-confirm-${width}.png`});
 await dialog.getByRole('button',{name:'确认撤销角色'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText('角色已更新');
 await expect(page.getByRole('row',{name:/manager@example\.invalid/})).toContainText('（已撤销）');
 expect(writes[0]).toMatchObject({club_id:club,user_id:uid,role:'admin',action:'revoke',expected_version:0});expect(writes[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
 await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();await dialog.getByLabel('目标俱乐部').selectOption(club);await expect(dialog).toContainText('当前状态：已撤销');
 await dialog.getByRole('button',{name:'恢复角色',exact:true}).click();await dialog.getByRole('button',{name:'确认恢复角色'}).click();await expect(dialog).toHaveCount(0);expect(writes[1]).toMatchObject({action:'grant',expected_version:1});await expect(page.getByRole('row',{name:/manager@example\.invalid/})).not.toContainText('（已撤销）');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a conflict requires fresh context and network retries retain the original request id',async({page})=>{
 await mock(page,true,overview,true);let version=0,attempts=0;const writes=[];
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,role_version:version,owner_id:club}],memberships:[]}}));
 await page.route('**/api/admin/assign-role',route=>{writes.push(route.request().postDataJSON());attempts++;if(attempts===1)return route.abort('failed');if(attempts===2){version=1;return route.fulfill({status:409,json:{error:'角色状态已变化，请刷新'}});}return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('目标俱乐部').selectOption(club);
 await dialog.getByRole('button',{name:'任命角色',exact:true}).click();await dialog.getByRole('button',{name:'确认任命角色'}).click();await expect(dialog.getByRole('button',{name:'确认任命角色'})).toBeEnabled();await dialog.getByRole('button',{name:'确认任命角色'}).click();
 await expect(dialog.getByRole('button',{name:'确认任命角色'})).toHaveCount(0);expect(writes[0]).toEqual(writes[1]);
 await dialog.getByRole('button',{name:'刷新角色状态'}).click();await dialog.getByRole('button',{name:'任命角色',exact:true}).click();await dialog.getByRole('button',{name:'确认任命角色'}).click();await expect(dialog).toHaveCount(0);
 expect(writes[2].expected_version).toBe(1);expect(writes[2].request_id).not.toBe(writes[1].request_id);
});

test('owner transfer is explicit and unverified users cannot receive roles',async({page})=>{
 await mock(page,true,overview,true);let verified=true;const writes=[];
 await page.route('**/api/admin/users?*',route=>route.fulfill({json:{users:[user('manager@example.invalid',{email_confirmed:verified})],next:null}}));
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,role_version:0,owner_id:club}],memberships:[]}}));
 await page.route('**/api/admin/assign-role',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('目标俱乐部').selectOption(club);await dialog.getByLabel('俱乐部角色').selectOption('owner');
 await dialog.getByRole('button',{name:'转让公会长',exact:true}).click();await expect(dialog).toContainText('双方其他角色保持原状');await dialog.getByRole('button',{name:'确认转让公会长'}).click();await expect(dialog).toHaveCount(0);expect(writes[0]).toMatchObject({action:'transfer',role:'owner'});
 verified=false;await page.reload();await page.getByRole('tab',{name:'用户与角色'}).click();await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();await dialog.getByLabel('目标俱乐部').selectOption(club);await expect(dialog).toContainText('此账户邮箱未验证');await expect(dialog.getByRole('button',{name:'任命角色',exact:true})).toBeDisabled();expect(writes).toHaveLength(1);
});

test('role dialog supports keyboard entry, Escape cancellation and focus return without writes',async({page})=>{
 await page.setViewportSize({width:390,height:900});await mock(page,true,overview,true);let writes=0;
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,role_version:0,owner_id:club}],memberships:[]}}));
 await page.route('**/api/admin/assign-role',route=>{writes++;return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();const trigger=page.getByRole('button',{name:'管理 manager@example.invalid 的角色'});await trigger.focus();await page.keyboard.press('Enter');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:'.test-artifacts/admin-role-opening-390.png'});
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('目标俱乐部')).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();expect(writes).toBe(0);
});

test('a page-two role operation survives first-page invalidation and preserves retry identity',async({page})=>{
 await mock(page,true,overview,true);const writes=[];let release,posted=false;
 await page.route('**/api/admin/users?*',route=>{const more=new URL(route.request().url()).searchParams.has('after');return route.fulfill({json:{users:[more?user('manager@example.invalid'):user('first@example.invalid',{id:club})],next:!more&&!posted?{key:'first',id:club}:null}});});
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,role_version:0,owner_id:club}],memberships:[]}}));
 await page.route('**/api/admin/assign-role',async route=>{writes.push(route.request().postDataJSON());posted=true;if(writes.length===1){await new Promise(resolve=>{release=resolve;});return route.abort('failed');}return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();await page.getByRole('button',{name:'更多用户'}).click();await page.getByRole('button',{name:'管理 manager@example.invalid 的角色'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('目标俱乐部').selectOption(club);await dialog.getByRole('button',{name:'任命角色',exact:true}).click();await dialog.getByRole('button',{name:'确认任命角色'}).click();
 await expect.poll(()=>typeof release).toBe('function');await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('row',{name:/manager@example\.invalid/})).toHaveCount(0);await expect(dialog).toContainText('网站账户：manager@example.invalid');
 release();await expect(dialog.getByRole('button',{name:'确认任命角色'})).toBeEnabled();await dialog.getByRole('button',{name:'确认任命角色'}).click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);await expect(page.getByLabel('搜索用户')).toBeFocused();
});

test('stale user and audit pagination cannot append after a refresh generation',async({page})=>{
 await mock(page,true,overview,true);let refreshed=false,releaseUsers,releaseEvents;
 await page.route('**/api/admin/users?*',async route=>{if(new URL(route.request().url()).searchParams.has('after')){await new Promise(resolve=>{releaseUsers=resolve;});return route.fulfill({json:{users:[user('stale@example.invalid')],next:{key:'stale',id:uid}}});}return route.fulfill({json:{users:[user(refreshed?'fresh@example.invalid':'first@example.invalid',{id:club})],next:refreshed?null:{key:'first',id:club}}});});
 await page.route('**/api/admin/activity*',async route=>{if(new URL(route.request().url()).searchParams.has('before')){await new Promise(resolve=>{releaseEvents=resolve;});return route.fulfill({json:{events:[{...activity.events[0],id:'stale-event',subject:'stale-audit@example.invalid'}],next:{before:'2026-10-01T00:00:00Z',id:uid}}});}return route.fulfill({json:{events:[activity.events[0]],next:refreshed?null:{before:'2026-10-30T12:00:00Z',id:uid}}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与角色'}).click();await page.getByRole('button',{name:'更多用户'}).click();await expect.poll(()=>typeof releaseUsers).toBe('function');refreshed=true;await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('row',{name:/fresh@example\.invalid/})).toBeVisible();releaseUsers();await page.waitForLoadState('networkidle');await expect(page.getByRole('row',{name:/stale@example\.invalid/})).toHaveCount(0);await expect(page.getByRole('button',{name:'更多用户'})).toHaveCount(0);
 refreshed=false;await page.getByRole('tab',{name:'平台日志'}).click();await page.getByRole('button',{name:'更早记录'}).click();await expect.poll(()=>typeof releaseEvents).toBe('function');refreshed=true;await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('button',{name:'更早记录'})).toHaveCount(0);releaseEvents();await page.waitForLoadState('networkidle');await expect(page.getByText('stale-audit@example.invalid')).toHaveCount(0);await expect(page.getByRole('button',{name:'更早记录'})).toHaveCount(0);
});
