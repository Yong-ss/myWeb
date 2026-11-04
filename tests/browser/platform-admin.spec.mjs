import {test,expect} from '@playwright/test';
// Stage E: the platform admin workspace. Mocks follow the real Worker contract; the database decides what is real,
// so these check that the page offers only what the account may do and explains MFA in plain words.
const A='00000000-0000-4000-8000-0000000000a1',uid='00000000-0000-4000-8000-0000000000aa',self='00000000-0000-4000-8000-0000000000bb';
const account=(active,extra={})=>({email:'pa@example.invalid',club_id:A,roles:[],permissions:[],super_admin:false,mfa_verified:false,mfa_session:active,platform_admin:true,platform_permissions:active?['platform.read','platform.roles.assign']:[],clubs:[],...extra});
const overview={totals:{clubs:1,users:3,confirmed_users:3,members:2,active_roles:2},alliances:null,clubs:[{id:A,name:'甲俱乐部',members:2,players:10,latest_snapshot:null,player_counts:null,admins:1,admin_limit:5}]};
const user=(id,email,extra={})=>({id,email,email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,memberships:[],effective:[],...extra});
async function mock(page,acct,{writes=[]}={}){
 const seen=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  seen.push(url.pathname);
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/account')return json(acct);
  if(url.pathname==='/api/mfa')return json({factors:[{id:uid,name:'手机',created_at:null,trusted:false}]});
  if(!acct.platform_permissions.includes('platform.read')&&url.pathname.startsWith('/api/admin/'))return json({error:'需要平台管理权限，并在本次登录完成两步验证'},403);
  if(url.pathname==='/api/admin/overview')return json(overview);
  // The database leaves the super_admin flag out for a platform admin.
  if(url.pathname==='/api/admin/users')return json({users:[user(uid,'manager@example.invalid',{platform_admin:true}),user(self,'pa@example.invalid',{platform_admin:true}),user(A,'boss@example.invalid')],next:null});
  if(url.pathname==='/api/admin/activity')return json({events:[{id:uid,created_at:'2026-10-30T12:00:00Z',action:'platform_role_assignments.insert',via:'authenticator',actor:null,actor_kind:'super_admin',subject:'manager@example.invalid',club:null,details:{new:{role:'platform_admin',status:'active'}}}],next:null});
  if(url.pathname==='/api/admin/platform-admin'){writes.push(route.request().postDataJSON());return json({changed:true});}
  return json({error:'Unknown test endpoint'},404);
 });
 return seen;
}

test('a platform admin without any club lands in the platform centre and is guided to MFA without SQL Editor steps',async({page})=>{
 const seen=await mock(page,account(false));
 await page.goto('/login');await expect(page).toHaveURL(/\/admin$/);
 await expect(page.locator('.club-header-account')).toContainText('平台管理员（待两步验证）');
 await expect(page.getByRole('heading',{name:'请完成两步验证'})).toBeVisible();
 await expect(page.getByText('平台管理员需要在本次登录完成两步验证')).toBeVisible();
 expect(seen.filter(p=>p.startsWith('/api/admin/'))).toEqual([]);
 await page.getByRole('link',{name:'前往两步验证'}).click();await expect(page).toHaveURL(/\/admin\/security$/);
 await expect(page.getByText('平台管理功能只在本次登录完成两步验证后才能使用')).toBeVisible();
 // No Super Admin device confirmation for a platform admin.
 await expect(page.getByText('SQL Editor')).toHaveCount(0);await expect(page.getByText('待确认')).toHaveCount(0);
});

for(const width of [1440,390])test(`an active platform admin sees role management only, never Super-Admin-only tools ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await mock(page,account(true));
 await page.goto('/admin');await expect(page.locator('.club-header-account')).toContainText('平台管理员');
 await expect(page.getByRole('heading',{name:'平台管理中心',level:1})).toBeVisible();
 // No club entry without a role there, and no admin-limit editing.
 await expect(page.getByRole('link',{name:/进入管理/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/修改上限/})).toHaveCount(0);
 await page.getByRole('tab',{name:'用户与职位'}).click();
 await expect(page.getByRole('button',{name:'管理 manager@example.invalid 的职位'})).toBeVisible();
 // Their own account: no role management (the database refuses it anyway); no Super Admin identity shown for anyone.
 await expect(page.getByRole('button',{name:'管理 pa@example.invalid 的职位'})).toHaveCount(0);
 await expect(page.getByText('超级管理员',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/平台管理员/})).toHaveCount(0); // appointing is Super Admin only
 await expect(page.getByText('平台管理员',{exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`platform-admin-users-${width}.png`)});
 await page.getByRole('tab',{name:'平台日志'}).click();
 await expect(page.getByRole('cell',{name:'超级管理员',exact:true})).toBeVisible();
 await expect(page.getByText('超级管理员的操作只显示为「超级管理员」')).toBeVisible();
});

test('the Super Admin appoints and revokes platform admins with a confirmation',async({page})=>{
 const writes=[];
 await mock(page,account(true,{super_admin:true,platform_admin:false,mfa_verified:true,platform_permissions:['platform.platform_admins.assign','platform.read','platform.roles.assign']}),{writes});
 await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();
 await page.getByRole('button',{name:'撤销 manager@example.invalid 的平台管理员职位'}).click();
 const dialog=page.getByRole('alertdialog');await expect(dialog).toContainText('撤销后立即生效');
 await dialog.getByRole('button',{name:'取消'}).click();expect(writes).toEqual([]);
 await page.getByRole('button',{name:'撤销 manager@example.invalid 的平台管理员职位'}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'确认撤销'}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({user_id:uid,action:'revoke'});
 await page.getByRole('button',{name:'任命 boss@example.invalid 为平台管理员'}).click();
 await expect(page.getByRole('alertdialog')).toContainText('不能修改其他权限设置');
 await page.getByRole('alertdialog').getByRole('button',{name:'确认任命'}).click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual({user_id:A,action:'grant'});
});
