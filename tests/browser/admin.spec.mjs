import {test,expect} from '@playwright/test';
// Platform panel UI with mocked APIs. Access itself is enforced by the Worker and database (see worker/admin.test.mjs,
// supabase/tests/platform_admin.sql and tests/integration/admin.spec.mjs); here we check what each account is shown.
const club='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-0000000000aa';
const account=platform=>({email:'boss@example.invalid',roles:['owner'],super_admin:true,mfa_verified:platform,mfa_session:platform,platform_permissions:platform?['platform.read']:[]});
const overview={totals:{clubs:2,users:5,confirmed_users:4,members:3,active_roles:4},alliances:null,clubs:[{id:club,name:'松鼠俱乐部',members:2,players:86,latest_snapshot:'2026-10-30'},{id:uid,name:'第二俱乐部',members:1,players:0,latest_snapshot:null}]};
const user=(email,extra={})=>({id:uid,email,email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,super_admin:false,memberships:[{club_id:club,club_name:'松鼠俱乐部',role:'admin',role_name:'管理员',status:'active'}],effective:[{club_id:club,club_name:'松鼠俱乐部',permissions:['audit.read','members.read']}],...extra});
const roles={permissions:[{key:'members.read',kind:'action',scopes:['platform','alliance','club'],sensitive:false,description:'查看成员名单'},{key:'club.rename',kind:'action',scopes:['club'],sensitive:false,description:'修改俱乐部名称'}],roles:[{key:'owner',name:'公会长',scope:'club',club_name:null,system:true,permissions:['club.rename','members.read'],assigned:1},{key:'admin',name:'管理员',scope:'club',club_name:null,system:true,permissions:['members.read'],assigned:2}]};
const activity={events:[{id:uid,created_at:'2026-10-30T12:00:00Z',action:'club_memberships.update',via:'authenticator',actor:'boss@example.invalid',subject:'manager@example.invalid',club:'松鼠俱乐部',details:{old:{role:'admin',status:'active'},new:{role:'admin',status:'revoked'}}},{id:club,created_at:'2026-10-29T12:00:00Z',action:'platform_super_admin_factors.insert',via:'postgres',actor:null,subject:'boss@example.invalid',club:null,details:{new:{factor_name:'手机'}}}],next:null};

async function mock(page,platform){
 const seen=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  seen.push(url.pathname+url.search);
  const json=body=>route.fulfill({json:body,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/account')return json(account(platform));
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(!platform&&url.pathname.startsWith('/api/admin/'))return route.fulfill({status:403,json:{error:'需要已完成两步验证、并使用已确认设备登录的超级管理员'}});
  if(url.pathname==='/api/admin/overview')return json(overview);
  if(url.pathname==='/api/admin/users')return json({users:url.searchParams.get('q')?[user('manager@example.invalid')]:[user('manager@example.invalid'),user('boss@example.invalid',{id:club,super_admin:true,memberships:[],effective:[]})],next:null});
  if(url.pathname==='/api/admin/roles')return json(roles);
  if(url.pathname==='/api/admin/activity')return json(activity);
  return route.fulfill({status:404,json:{error:'Unknown test endpoint'}});
 });
 return seen;
}

test('a Super Admin without platform access (aal1 or unconfirmed device) sees no link and no data',async({page})=>{
 const seen=await mock(page,false);
 await page.goto('/account');await expect(page.locator('.club-header-account')).toContainText('boss@example.invalid');
 await expect(page.getByRole('link',{name:'平台管理'})).toHaveCount(0);
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'需要超级管理员权限'})).toBeVisible();
 await expect(page.getByRole('link',{name:'前往设置'})).toBeVisible();
 // The page never even asks for platform data when the account has no platform permission.
 expect(seen.filter(p=>p.startsWith('/api/admin/'))).toEqual([]);
});

for(const width of [1440,390])test(`the active Super Admin reads overview, users, roles and the platform log ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const seen=await mock(page,true);
 await page.goto('/account');await page.getByRole('link',{name:'平台管理'}).click();
 await expect(page).toHaveURL(/\/admin$/);await expect(page.getByRole('heading',{name:'平台管理',level:1})).toBeVisible();
 // Overview: real counts, and alliances are reported as not enabled rather than a made-up zero.
 await expect(page.getByText('未启用',{exact:true})).toBeVisible();await expect(page.getByText('4 个已验证邮箱')).toBeVisible();
 await expect(page.getByRole('row',{name:/松鼠俱乐部/})).toContainText('86');
 await page.screenshot({path:`.test-artifacts/admin-overview-${width}.png`});
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
