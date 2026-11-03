import {test,expect} from '@playwright/test';
// Platform panel UI with mocked APIs. Access itself is enforced by the Worker and database (see worker/admin.test.mjs,
// supabase/tests/platform_admin.sql and tests/integration/admin.spec.mjs); here we check what each account is shown.
const club='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-0000000000aa';
const account=platform=>({email:'boss@example.invalid',club_id:club,roles:['owner'],permissions:['members.read'],super_admin:true,mfa_verified:platform,mfa_session:platform,platform_permissions:platform?['platform.read']:[]});
const overview={totals:{clubs:2,users:5,confirmed_users:4,members:3,active_roles:4},alliances:null,clubs:[{id:club,name:'松鼠俱乐部',members:2,players:86,latest_snapshot:'2026-10-30',is_complete_roster:false,player_counts:{present:64,temporary:3,confirmed_left:8,unconfirmed:7,other_left:4}},{id:uid,name:'第二俱乐部',members:1,players:0,latest_snapshot:null,player_counts:null}]};
const user=(email,extra={})=>({id:uid,email,email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,super_admin:false,memberships:[{club_id:club,club_name:'松鼠俱乐部',role:'admin',role_name:'管理员',status:'active'}],effective:[{club_id:club,club_name:'松鼠俱乐部',permissions:['audit.read','members.read']}],...extra});
const settings=(extra={})=>({permissions:[{key:'club.rename',description:'修改俱乐部名称',sensitive:false,non_delegable:false},{key:'imports.delete',description:'删除某日全部数据',sensitive:true,non_delegable:false},{key:'members.read',description:'查看成员名单',sensitive:false,non_delegable:false},{key:'test.manage',description:'任命管理员',sensitive:true,non_delegable:true}],
 roles:[{key:'owner',name:'公会长'},{key:'admin',name:'管理员'}],defaults:[{role:'owner',permission:'club.rename'},{role:'owner',permission:'imports.delete'},{role:'owner',permission:'members.read'},{role:'owner',permission:'test.manage'},{role:'admin',permission:'members.read'}],
 cap_blocks:[],clubs:[{id:club,name:'松鼠俱乐部'}],club_id:null,club_defaults:[],...extra});
const activity={events:[{id:uid,created_at:'2026-10-30T12:00:00Z',action:'club_memberships.update',via:'authenticator',actor:'boss@example.invalid',subject:'manager@example.invalid',club:'松鼠俱乐部',details:{old:{role:'admin',status:'active'},new:{role:'admin',status:'revoked'}}},{id:club,created_at:'2026-10-29T12:00:00Z',action:'platform_super_admin_factors.insert',via:'postgres',actor:null,subject:'boss@example.invalid',club:null,details:{new:{factor_name:'手机'}}}],next:null};

async function mock(page,platform,data=overview,write=false){
 const seen=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  seen.push(url.pathname+url.search);
  const json=body=>route.fulfill({json:body,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/account')return json({...account(platform),platform_permissions:platform?['platform.read',...(write?['platform.roles.assign','platform.clubs.admin_limit','platform.permissions.manage']:[])]:[]});
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(!platform&&url.pathname.startsWith('/api/admin/'))return route.fulfill({status:403,json:{error:'需要已完成两步验证、并使用已确认设备登录的超级管理员'}});
  if(url.pathname==='/api/admin/overview')return json(data);
  if(url.pathname==='/api/admin/users')return json({users:url.searchParams.get('q')?[user('manager@example.invalid')]:[user('manager@example.invalid'),user('boss@example.invalid',{id:club,super_admin:true,memberships:[],effective:[]})],next:null});
  if(url.pathname==='/api/admin/permission-settings')return json(settings({club_id:url.searchParams.get('club')}));
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
 // Stage D: every club can be entered from here, each in its own URL (the Worker and database check it on arrival).
 await expect(page.getByRole('link',{name:'进入管理松鼠俱乐部'})).toHaveAttribute('href',`/account?club=${club}`);
 await expect(page.getByRole('link',{name:'进入管理第二俱乐部'})).toHaveAttribute('href',`/account?club=${uid}`);await expect(page.getByText('暂未开放')).toHaveCount(0);
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
 await page.getByRole('tab',{name:'用户与职位'}).click();
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

// Role dialog helpers: open for the user, pick the club, then pick an action by its plain Chinese label.
const openRoles=async(page,email='manager@example.invalid')=>{await page.getByRole('button',{name:`管理 ${email} 的职位`}).click();return page.getByRole('dialog');};
const context=(memberships,extra={})=>({clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,admins:2,role_version:0,owner_id:club,...extra}],memberships});

for(const width of [1440,390,320])test(`role changes show the current position, confirm the revoke and restore with refreshed status ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page,true,overview,true);
 let version=0,status='active';const writes=[];
 await page.route('**/api/admin/users?*',route=>route.fulfill({json:{users:[user('manager@example.invalid',{memberships:[{club_id:club,club_name:'松鼠俱乐部',role:'admin',role_name:'管理员',status}],effective:status==='active'?[{club_id:club,club_name:'松鼠俱乐部',permissions:['members.read']}]:[]})],next:null}}));
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:{clubs:[{id:club,name:'松鼠俱乐部',admin_limit:5,admins:status==='active'?2:1,role_version:version,owner_id:club},{id:uid,name:'第二俱乐部',admin_limit:5,admins:0,role_version:0,owner_id:null}],memberships:[{club_id:club,role:'admin',status}]}}));
 await page.route('**/api/admin/assign-role',route=>{const body=route.request().postDataJSON();writes.push(body);status=body.action==='revoke'?'revoked':'active';version++;return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();
 const dialog=await openRoles(page);
 await expect(dialog).toContainText('网站账户：manager@example.invalid');await expect(dialog.getByRole('button',{name:'下一步'})).toBeDisabled();
 await dialog.getByLabel('目标俱乐部').selectOption(club);await expect(dialog).toContainText('当前职位：管理员 · 管理员 2 / 5 人');
 // An admin is never offered a second role in the same club: only revoke, remove or transfer.
 await expect(dialog.getByRole('radio',{name:'任命为管理员'})).toHaveCount(0);await expect(dialog.getByRole('radio',{name:'任命为公会长'})).toHaveCount(0);
 await dialog.getByRole('radio',{name:'撤销管理员职位'}).check();await dialog.getByRole('button',{name:'下一步'}).click();
 await expect(dialog).toContainText('俱乐部：松鼠俱乐部');await expect(dialog).toContainText('操作：撤销管理员职位');
 await expect(dialog.getByText('管理员权限将立即失效',{exact:false})).toBeVisible();
 await page.screenshot({path:`.test-artifacts/admin-role-confirm-${width}.png`});
 await dialog.getByRole('button',{name:'确认撤销职位'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText('职位已更新');
 await expect(page.getByRole('row',{name:/manager@example\.invalid/})).toContainText('（已撤销）');
 expect(writes[0]).toMatchObject({club_id:club,user_id:uid,role:'admin',action:'revoke',expected_version:0});expect(writes[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
 await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);await expect(dialog).toContainText('当前职位：无');
 await dialog.getByRole('radio',{name:'任命为管理员'}).check();await dialog.getByRole('button',{name:'下一步'}).click();await dialog.getByRole('button',{name:'确认任命管理员'}).click();await expect(dialog).toHaveCount(0);
 expect(writes[1]).toMatchObject({role:'admin',action:'grant',expected_version:1});await expect(page.getByRole('row',{name:/manager@example\.invalid/})).not.toContainText('（已撤销）');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a conflict requires fresh context and network retries retain the original request id',async({page})=>{
 await mock(page,true,overview,true);let version=0,attempts=0;const writes=[];
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:context([],{role_version:version})}));
 await page.route('**/api/admin/assign-role',route=>{writes.push(route.request().postDataJSON());attempts++;if(attempts===1)return route.abort('failed');if(attempts===2){version=1;return route.fulfill({status:409,json:{error:'角色状态已变化，请刷新'}});}return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();const dialog=await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 const appoint=async()=>{await dialog.getByRole('radio',{name:'任命为管理员'}).check();await dialog.getByRole('button',{name:'下一步'}).click();};
 await appoint();await dialog.getByRole('button',{name:'确认任命管理员'}).click();await expect(dialog.getByRole('button',{name:'确认任命管理员'})).toBeEnabled();await dialog.getByRole('button',{name:'确认任命管理员'}).click();
 await expect(dialog.getByRole('button',{name:'确认任命管理员'})).toHaveCount(0);expect(writes[0]).toEqual(writes[1]);
 await dialog.getByRole('button',{name:'刷新职位状态'}).click();await dialog.getByLabel('目标俱乐部').selectOption(club);await appoint();await dialog.getByRole('button',{name:'确认任命管理员'}).click();await expect(dialog).toHaveCount(0);
 expect(writes[2].expected_version).toBe(1);expect(writes[2].request_id).not.toBe(writes[1].request_id);
});

test('owner transfer requires choosing the previous owner outcome, and respects the admin limit',async({page})=>{
 await mock(page,true,overview,true);let verified=true,ctx=context([{club_id:club,role:'admin',status:'active'}]);const writes=[];
 await page.route('**/api/admin/users?*',route=>route.fulfill({json:{users:[user('manager@example.invalid',{email_confirmed:verified})],next:null}}));
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:ctx}));
 await page.route(/\/api\/admin\/(assign-role|transfer-owner|remove-from-club)$/,route=>{writes.push([new URL(route.request().url()).pathname,route.request().postDataJSON()]);return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();const dialog=await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 await dialog.getByRole('radio',{name:'转让公会长给此账户'}).check();
 // No default: the next step stays disabled until the previous owner's outcome is chosen.
 await expect(dialog.getByRole('radio',{name:'改任本俱乐部管理员'})).not.toBeChecked();await expect(dialog.getByRole('radio',{name:'移出此俱乐部',exact:true}).last()).not.toBeChecked();
 await expect(dialog.getByRole('button',{name:'下一步'})).toBeDisabled();
 await dialog.getByRole('radio',{name:'改任本俱乐部管理员'}).check();await dialog.getByRole('button',{name:'下一步'}).click();
 await expect(dialog).toContainText('原有的管理员职位同时撤销');await expect(dialog).toContainText('现任公会长将改任管理员');await expect(dialog).toContainText('任何一步失败都不会生效');
 await dialog.getByRole('button',{name:'确认转让公会长'}).click();await expect(dialog).toHaveCount(0);
 expect(writes[0][0]).toBe('/api/admin/transfer-owner');expect(writes[0][1]).toMatchObject({club_id:club,user_id:uid,previous_owner:'admin',expected_version:0});
 // A full club and a successor without a role: the previous owner cannot stay as admin, only leave.
 ctx=context([],{admins:5});await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 await expect(dialog.getByRole('radio',{name:/任命为管理员/})).toBeDisabled();await expect(dialog).toContainText('已达到管理员人数上限（5 人）');
 await dialog.getByRole('radio',{name:'转让公会长给此账户'}).check();await expect(dialog.getByRole('radio',{name:/改任本俱乐部管理员/})).toBeDisabled();
 await dialog.getByRole('radio',{name:'移出此俱乐部'}).check();await dialog.getByRole('button',{name:'下一步'}).click();await expect(dialog).toContainText('现任公会长将移出此俱乐部');
 await dialog.getByRole('button',{name:'返回修改'}).click();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);
 // The owner cannot be revoked or removed from here at all.
 ctx=context([{club_id:club,role:'owner',status:'active'}],{owner_id:uid});await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 await expect(dialog).toContainText('当前职位：公会长');await expect(dialog).toContainText('公会长不能直接撤销或移出');await expect(dialog.getByRole('radio')).toHaveCount(0);
 await page.keyboard.press('Escape');
 verified=false;ctx=context([]);await page.reload();await page.getByRole('tab',{name:'用户与职位'}).click();await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 await expect(dialog).toContainText('此账户邮箱未验证');await dialog.getByRole('radio',{name:'任命为管理员'}).check();await expect(dialog.getByRole('button',{name:'下一步'})).toBeDisabled();expect(writes).toHaveLength(1);
});

test('remove from this club is confirmed and only names this club',async({page})=>{
 await mock(page,true,overview,true);const writes=[];
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:context([{club_id:club,role:'admin',status:'active'}])}));
 await page.route('**/api/admin/remove-from-club',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();const dialog=await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);
 await dialog.getByRole('radio',{name:'移出此俱乐部'}).check();await dialog.getByRole('button',{name:'下一步'}).click();
 await expect(dialog).toContainText('不影响其他俱乐部，也不删除账户或历史记录');expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'确认移出俱乐部'}).click();await expect(dialog).toHaveCount(0);
 expect(writes).toEqual([{club_id:club,user_id:uid,expected_version:0,request_id:writes[0].request_id}]);
});

test('the Super Admin changes a club admin limit; a refused lower limit is explained',async({page})=>{
 // The panel shows 1 admin, but another was appointed meanwhile: the database refuses and the reason is shown.
 await mock(page,true,{...overview,clubs:overview.clubs.map(c=>({...c,admins:1,admin_limit:5}))},true);const writes=[];
 await page.route('**/api/admin/admin-limit',route=>{const body=route.request().postDataJSON();writes.push(body);return body.admin_limit<2?route.fulfill({status:409,json:{error:'该俱乐部目前有 2 名有效管理员，上限不能低于此数。请先撤销多余的管理员。'}}):route.fulfill({json:{changed:true}});});
 await page.goto('/admin');const row=page.getByRole('row',{name:/松鼠俱乐部/});await expect(row).toContainText('管理员 1 / 5');
 await row.getByRole('button',{name:'修改松鼠俱乐部的管理员人数上限'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('降低上限不会自动撤销任何人');const input=dialog.getByLabel('最多管理员人数');
 await expect(dialog.getByRole('button',{name:'保存上限'})).toBeDisabled();
 await input.fill('1');await dialog.getByRole('button',{name:'保存上限'}).click();await expect(dialog).toContainText('上限不能低于此数');
 await input.fill('3');await dialog.getByRole('button',{name:'保存上限'}).click();await expect(dialog).toHaveCount(0);
 expect(writes).toEqual([{club_id:club,admin_limit:1},{club_id:club,admin_limit:3}]);
});

test('role dialog supports keyboard entry, Escape cancellation and focus return without writes',async({page})=>{
 await page.setViewportSize({width:390,height:900});await mock(page,true,overview,true);let writes=0;
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:context([])}));
 await page.route('**/api/admin/assign-role',route=>{writes++;return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();const trigger=page.getByRole('button',{name:'管理 manager@example.invalid 的职位'});await trigger.focus();await page.keyboard.press('Enter');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:'.test-artifacts/admin-role-opening-390.png'});
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('目标俱乐部')).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();expect(writes).toBe(0);
});

test('a page-two role operation survives first-page invalidation and preserves retry identity',async({page})=>{
 await mock(page,true,overview,true);const writes=[];let release,posted=false;
 await page.route('**/api/admin/users?*',route=>{const more=new URL(route.request().url()).searchParams.has('after');return route.fulfill({json:{users:[more?user('manager@example.invalid'):user('first@example.invalid',{id:club})],next:!more&&!posted?{key:'first',id:club}:null}});});
 await page.route('**/api/admin/role-context?*',route=>route.fulfill({json:context([])}));
 await page.route('**/api/admin/assign-role',async route=>{writes.push(route.request().postDataJSON());posted=true;if(writes.length===1){await new Promise(resolve=>{release=resolve;});return route.abort('failed');}return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();await page.getByRole('button',{name:'更多用户'}).click();const dialog=await openRoles(page);await dialog.getByLabel('目标俱乐部').selectOption(club);await dialog.getByRole('radio',{name:'任命为管理员'}).check();await dialog.getByRole('button',{name:'下一步'}).click();await dialog.getByRole('button',{name:'确认任命管理员'}).click();
 await expect.poll(()=>typeof release).toBe('function');await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('row',{name:/manager@example\.invalid/})).toHaveCount(0);await expect(dialog).toContainText('网站账户：manager@example.invalid');
 release();await expect(dialog.getByRole('button',{name:'确认任命管理员'})).toBeEnabled();await dialog.getByRole('button',{name:'确认任命管理员'}).click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);await expect(page.getByLabel('搜索用户')).toBeFocused();
});

test('stale user and audit pagination cannot append after a refresh generation',async({page})=>{
 await mock(page,true,overview,true);let refreshed=false,releaseUsers,releaseEvents;
 await page.route('**/api/admin/users?*',async route=>{if(new URL(route.request().url()).searchParams.has('after')){await new Promise(resolve=>{releaseUsers=resolve;});return route.fulfill({json:{users:[user('stale@example.invalid')],next:{key:'stale',id:uid}}});}return route.fulfill({json:{users:[user(refreshed?'fresh@example.invalid':'first@example.invalid',{id:club})],next:refreshed?null:{key:'first',id:club}}});});
 await page.route('**/api/admin/activity*',async route=>{if(new URL(route.request().url()).searchParams.has('before')){await new Promise(resolve=>{releaseEvents=resolve;});return route.fulfill({json:{events:[{...activity.events[0],id:'stale-event',subject:'stale-audit@example.invalid'}],next:{before:'2026-10-01T00:00:00Z',id:uid}}});}return route.fulfill({json:{events:[activity.events[0]],next:refreshed?null:{before:'2026-10-30T12:00:00Z',id:uid}}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();await page.getByRole('button',{name:'更多用户'}).click();await expect.poll(()=>typeof releaseUsers).toBe('function');refreshed=true;await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('row',{name:/fresh@example\.invalid/})).toBeVisible();releaseUsers();await page.waitForLoadState('networkidle');await expect(page.getByRole('row',{name:/stale@example\.invalid/})).toHaveCount(0);await expect(page.getByRole('button',{name:'更多用户'})).toHaveCount(0);
 refreshed=false;await page.getByRole('tab',{name:'平台日志'}).click();await page.getByRole('button',{name:'更早记录'}).click();await expect.poll(()=>typeof releaseEvents).toBe('function');refreshed=true;await page.evaluate(()=>window.dispatchEvent(new Event('club-data-invalidated')));await expect(page.getByRole('button',{name:'更早记录'})).toHaveCount(0);releaseEvents();await page.waitForLoadState('networkidle');await expect(page.getByText('stale-audit@example.invalid')).toHaveCount(0);await expect(page.getByRole('button',{name:'更早记录'})).toHaveCount(0);
});

// Stage B settings: ordinary toggles save at once with visible feedback, widening a sensitive permission asks first,
// the non-delegable rule is shown as locked, and permission codes stay inside 高级详情.
for(const width of [1440,390])test(`the Super Admin edits defaults, caps and club defaults with clear saved state ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page,true,overview,true);
 let state=settings(),fail=false;const writes=[];
 await page.route('**/api/admin/permission-settings*',route=>route.fulfill({json:{...state,club_id:new URL(route.request().url()).searchParams.get('club')}}));
 await page.route('**/api/admin/role-permission',route=>{const b=route.request().postDataJSON();writes.push(b);if(fail)return route.fulfill({status:409,json:{error:'此权限仅限公会长，不能授予管理员（系统安全规则）'}});
  if(b.layer==='platform_default')state={...state,defaults:b.value?[...state.defaults,{role:b.role,permission:b.permission}]:state.defaults.filter(d=>!(d.role===b.role&&d.permission===b.permission))};
  if(b.layer==='cap')state={...state,cap_blocks:b.value?state.cap_blocks.filter(d=>!(d.role===b.role&&d.permission===b.permission)):[...state.cap_blocks,{role:b.role,permission:b.permission}]};
  if(b.layer==='club_default')state={...state,club_defaults:[...state.club_defaults.filter(d=>!(d.role===b.role&&d.permission===b.permission)),...(b.value===null?[]:[{role:b.role,permission:b.permission,allowed:b.value}])]};
  return route.fulfill({json:{changed:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'角色与权限'}).click();
 const rename=page.getByRole('checkbox',{name:'管理员：修改俱乐部名称'});await expect(rename).not.toBeChecked();
 await rename.click();await expect(page.getByRole('alertdialog')).toHaveCount(0);
 await expect(page.getByRole('status')).toHaveText('已保存：管理员 · 修改俱乐部名称 → 允许');await expect(rename).toBeChecked();
 expect(writes[0]).toEqual({layer:'platform_default',role:'admin',permission:'club.rename',value:true});
 // Sensitive and widening: confirmation first; cancelling writes nothing.
 await page.getByRole('checkbox',{name:'管理员：删除某日全部数据'}).click();const confirm=page.getByRole('alertdialog');
 await expect(confirm).toContainText('管理员 · 删除某日全部数据 → 允许');await confirm.getByRole('button',{name:'取消'}).click();await expect(confirm).toHaveCount(0);expect(writes).toHaveLength(1);
 // Narrowing a sensitive permission needs no confirmation.
 await page.getByRole('checkbox',{name:'公会长：删除某日全部数据'}).click();await expect(page.getByRole('status')).toContainText('公会长 · 删除某日全部数据 → 不允许');expect(writes).toHaveLength(2);
 await page.getByRole('checkbox',{name:'管理员：删除某日全部数据'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认允许'}).click();
 await expect(page.getByRole('status')).toContainText('管理员 · 删除某日全部数据 → 允许');expect(writes[2]).toMatchObject({role:'admin',permission:'imports.delete',value:true});
 // Non-delegable permissions are locked for admins; codes are not in the main view.
 await expect(page.getByRole('row',{name:/任命管理员/})).toContainText('只有公会长可以拥有');
 await expect(page.getByRole('checkbox',{name:'管理员：任命管理员'})).toHaveCount(0);
 await expect(page.locator('table')).not.toContainText('members.read');
 await page.getByRole('button',{name:'高级详情'}).click();await expect(page.getByText('members.read',{exact:true})).toBeVisible();
 // Caps: blocking shows its effect on the defaults view.
 await page.getByLabel('设置内容').selectOption('cap');await page.getByRole('checkbox',{name:'管理员：查看成员名单'}).click();
 await expect(page.getByRole('status')).toHaveText('已保存：管理员 · 查看成员名单 → 超出上限');expect(writes[3]).toEqual({layer:'cap',role:'admin',permission:'members.read',value:false});
 await page.getByLabel('设置内容').selectOption('platform_default');await expect(page.getByRole('row',{name:/查看成员名单/})).toContainText('受上限限制，不生效');
 // Club default: tri-state; "follow" says what it follows.
 await page.getByLabel('设置内容').selectOption(club);const select=page.getByLabel('管理员：修改俱乐部名称');
 await expect(select).toHaveValue('follow');await expect(select.locator('option:checked')).toHaveText('跟随全平台（允许）');
 await select.selectOption('deny');await expect(page.getByRole('status')).toHaveText('已保存：松鼠俱乐部 · 管理员 · 修改俱乐部名称 → 不允许');
 expect(writes[4]).toEqual({layer:'club_default',role:'admin',permission:'club.rename',value:false,club_id:club});
 // A refused save is shown as failed with the server's reason, and the control keeps the stored value.
 fail=true;const owner=page.getByLabel('公会长：修改俱乐部名称');await owner.selectOption('deny');
 const failed=page.getByRole('alert').filter({hasText:'保存失败'});await expect(failed).toContainText('公会长 · 修改俱乐部名称');await expect(failed).toContainText('系统安全规则');await expect(owner).toHaveValue('follow');
 await page.screenshot({path:`.test-artifacts/admin-permissions-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a user\'s permission details explain each result in plain words and accept a forced personal setting',async({page})=>{
 await mock(page,true,overview,true);const writes=[];let forced=null;
 const explain=()=>({club_id:club,user_id:uid,role:'admin',role_name:'管理员',email_confirmed:true,super_admin:false,permissions:[
  {key:'imports.delete',description:'删除某日全部数据',sensitive:true,non_delegable:false,layer:forced===true?'cap':'default_deny',allowed:false,platform_default:false,cap_blocked:forced===true,club_default:null,forced,owner_set:null},
  {key:'members.read',description:'查看成员名单',sensitive:false,non_delegable:false,layer:'default_allow',allowed:true,platform_default:true,cap_blocked:false,club_default:null,forced:null,owner_set:null},
  {key:'test.manage',description:'任命管理员',sensitive:true,non_delegable:true,layer:'non_delegable',allowed:false,platform_default:false,cap_blocked:false,club_default:null,forced:null,owner_set:null}]});
 await page.route('**/api/admin/permission-explain?*',route=>route.fulfill({json:explain()}));
 await page.route('**/api/admin/personal-permission',route=>{const b=route.request().postDataJSON();writes.push(b);if(b.permission==='imports.delete')forced=b.value;return route.fulfill({json:{changed:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();
 await page.getByRole('button',{name:'查看 manager@example.invalid 的权限'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('当前职位：管理员');await expect(dialog).toContainText('原因：全平台默认不允许');await expect(dialog).toContainText('原因：系统安全规则：只有公会长可以拥有');
 await expect(dialog.locator('ul')).not.toContainText('imports.delete');
 await expect(dialog.locator('li',{hasText:'任命管理员'}).getByLabel('超级管理员设置').locator('option[value="allow"]')).toBeDisabled();
 // Sensitive widening is confirmed; the result then shows that the cap still stops it.
 await dialog.locator('li',{hasText:'删除某日全部数据'}).getByLabel('超级管理员设置').selectOption('allow');
 await page.getByRole('alertdialog').getByRole('button',{name:'确认允许'}).click();
 await expect(page.getByRole('status')).toContainText('删除某日全部数据 → 单独允许');
 expect(writes).toEqual([{club_id:club,user_id:uid,permission:'imports.delete',value:true}]);
 await expect(dialog).toContainText('已单独允许，但超出该职位的权限上限，未生效');
 await dialog.locator('li',{hasText:'查看成员名单'}).getByLabel('超级管理员设置').selectOption('deny');await expect(page.getByRole('alertdialog')).toHaveCount(0);
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual({club_id:club,user_id:uid,permission:'members.read',value:false});
});

// Confirmation is about the final result, not the menu choice: 单独禁止 → 跟随默认 reopens a sensitive permission when a
// lower layer allows it, so it must be confirmed; when the lower layers deny it too, nothing widens and it saves directly.
test('returning a forced deny to the default confirms only when it reopens a sensitive permission',async({page})=>{
 await mock(page,true,overview,true);const writes=[];const forced={'imports.delete':false,'audit.read':false};
 const perm=(key,description,platform_default)=>({key,description,sensitive:true,non_delegable:false,layer:forced[key]===false?'forced_deny':platform_default?'default_allow':'default_deny',
  allowed:forced[key]!==false&&platform_default,platform_default,cap_blocked:false,club_default:null,forced:forced[key],owner_set:null});
 await page.route('**/api/admin/permission-explain?*',route=>route.fulfill({json:{club_id:club,user_id:uid,role:'admin',role_name:'管理员',email_confirmed:true,super_admin:false,
  permissions:[perm('imports.delete','删除某日全部数据',true),perm('audit.read','查看操作日志',false)]}}));
 await page.route('**/api/admin/personal-permission',route=>{const b=route.request().postDataJSON();writes.push(b);forced[b.permission]=b.value;return route.fulfill({json:{changed:true}});});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();
 await page.getByRole('button',{name:'查看 manager@example.invalid 的权限'}).click();const dialog=page.getByRole('dialog');
 const reopen=dialog.locator('li',{hasText:'删除某日全部数据'}).getByLabel('超级管理员设置');
 // Cancel: nothing is written and the setting stays 单独禁止.
 await reopen.selectOption('follow');const confirm=page.getByRole('alertdialog');await expect(confirm).toContainText('删除某日全部数据 → 跟随默认');
 await confirm.getByRole('button',{name:'取消'}).click();await expect(confirm).toHaveCount(0);
 expect(writes).toEqual([]);await expect(reopen).toHaveValue('deny');
 // Confirm: the follow is saved and the permission is open again.
 await reopen.selectOption('follow');await page.getByRole('alertdialog').getByRole('button',{name:'确认允许'}).click();
 await expect(page.getByRole('status')).toContainText('删除某日全部数据 → 跟随默认');
 expect(writes).toEqual([{club_id:club,user_id:uid,permission:'imports.delete',value:null}]);
 await expect(dialog.locator('li',{hasText:'删除某日全部数据'})).toContainText('原因：全平台默认允许');
 // The platform default denies 查看操作日志 too, so following it widens nothing: saved without a confirmation.
 await dialog.locator('li',{hasText:'查看操作日志'}).getByLabel('超级管理员设置').selectOption('follow');
 await expect.poll(()=>writes.length).toBe(2);await expect(page.getByRole('alertdialog')).toHaveCount(0);
 expect(writes[1]).toEqual({club_id:club,user_id:uid,permission:'audit.read',value:null});
});
