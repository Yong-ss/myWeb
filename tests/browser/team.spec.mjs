import {test,expect} from '@playwright/test';
// The owner's 管理员管理 page with mocked APIs. Access is enforced by the Worker and database (worker/team.test.mjs,
// supabase/tests/owner_admins.sql, tests/integration/owner-admins.spec.mjs); here we check what the owner is shown
// and that every role change and sensitive widening is confirmed before anything is sent.
const club='00000000-0000-4000-8000-000000000001',a1='00000000-0000-4000-8000-0000000000a1',c1='00000000-0000-4000-8000-0000000000c1';
const ownerPermissions=['absences.resolve','aliases.manage','audit.read','club.admins.manage','club.admins.permissions','club.alliance.request','club.rename','imports.create','imports.delete','members.read'];
const account=permissions=>({email:'owner@example.invalid',club_id:club,roles:['owner'],permissions,super_admin:false,mfa_verified:false,mfa_session:false,platform_permissions:[],clubs:[{id:club,name:'松鼠俱乐部',roles:['owner']}]});
const perm=(key,description,sensitive,extra={})=>({key,description,sensitive,non_delegable:false,cap_blocked:false,platform_default:true,club_default:null,...extra});
const permissions=[perm('audit.read','查看操作日志',true,{club_default:false}),perm('club.admins.manage','任命、撤销和移出本俱乐部的管理员',true,{non_delegable:true,platform_default:false}),
 perm('club.rename','修改俱乐部名称',false,{platform_default:false}),perm('imports.delete','删除某日全部数据',true,{cap_blocked:true})];
const explained=(p,layer,allowed,extra={})=>({...p,layer,allowed,forced:null,owner_set:null,...extra});
const team={admin_limit:2,role_version:7,admins:[{user_id:a1,email:'a1@example.invalid',email_confirmed:true}]};
const teamPermissions={club_id:club,permissions,admins:[{user_id:a1,email:'a1@example.invalid',explain:{role:'admin',email_confirmed:true,permissions:[
 explained(permissions[0],'owner_deny',false,{owner_set:false}),explained(permissions[1],'non_delegable',false),
 explained(permissions[2],'forced_deny',false,{forced:false,owner_set:true}),explained(permissions[3],'cap',false)]}}]};
const candidate={user_id:c1,email:'c1@example.invalid',role:null,role_name:null,kept:[{key:'audit.read',description:'查看操作日志',sensitive:true,forced:null,owner_set:true,default_allowed:false,allowed:true}]};

async function mock(page,{perms=ownerPermissions,candidateBody=candidate,refuse=null}={}){
 const posts=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  if(route.request().method()==='POST'){posts.push([url.pathname,route.request().postDataJSON()]);return refuse?json({error:refuse},403):json({changed:true,role_version:8});}
  if(url.pathname==='/api/account')return json(account(perms));
  if(url.pathname==='/api/club-settings')return json({name:'松鼠俱乐部',can_edit:true});
  if(url.pathname==='/api/team')return json(team);
  if(url.pathname==='/api/team/permissions')return json(teamPermissions);
  if(url.pathname==='/api/team/candidate')return url.searchParams.get('email')==='nobody@example.invalid'?json({error:'找不到可任命的账户：请确认对方已注册网站账户并完成邮箱验证'},400):json(candidateBody);
  return json({snapshot:null,snapshots:[],members:[],points:[],next:null});
 });
 return posts;
}

test('the 管理员管理 entry is shown to the owner only; an admin never sees it',async({page})=>{
 await mock(page,{perms:ownerPermissions.filter(p=>!p.startsWith('club.admins.')&&p!=='club.rename')});
 await page.goto('/account');await expect(page.locator('.club-header-account')).toContainText('owner@example.invalid');
 await expect(page.locator('.club-sidebar').getByRole('link',{name:'操作日志'})).toBeVisible();
 await expect(page.getByRole('link',{name:'管理员管理'})).toHaveCount(0);
});

for(const width of [1440,390])test(`the owner sees admins, count and limit, and appoints only after the kept-settings warning ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const posts=await mock(page);
 await page.goto('/account');
 if(width<1024)await page.getByRole('button',{name:/^菜单/}).click();
 await page.getByRole('navigation',{name:'俱乐部导航'}).filter({visible:true}).getByRole('link',{name:'管理员管理'}).click();
 await expect(page.getByRole('heading',{name:'管理员管理',level:1})).toBeVisible();
 await expect(page.getByText('1 / 2')).toBeVisible();
 await expect(page.getByRole('cell',{name:'a1@example.invalid',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // An unknown account gets the server's plain message and nothing is opened.
 await page.getByLabel('任命新管理员').fill('nobody@example.invalid');await page.getByRole('button',{name:'检查账户'}).click();
 await expect(page.getByText('找不到可任命的账户')).toBeVisible();
 // A returning admin: the kept owner allow on a sensitive permission is named before anything is sent.
 await page.getByLabel('任命新管理员').fill('c1@example.invalid');await page.getByRole('button',{name:'检查账户'}).click();
 const dialog=page.getByRole('alertdialog',{name:'确认任命管理员'});
 await expect(dialog.getByRole('note',{name:'保留的个人权限设置'})).toContainText('查看操作日志：公会长单独允许，任命后允许（默认为不允许）');
 await expect(dialog.getByText('敏感权限将被开放')).toBeVisible();
 await dialog.getByRole('button',{name:'取消'}).click();expect(posts).toEqual([]);
 await page.getByRole('button',{name:'检查账户'}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'确认任命（设置将生效）'}).click();
 await expect(page.getByText('已任命：c1@example.invalid')).toBeVisible();
 expect(posts.length).toBe(1);expect(posts[0][0]).toBe('/api/team/role');
 expect(posts[0][1]).toMatchObject({user_id:c1,action:'grant',expected_version:7});expect(Object.keys(posts[0][1]).sort()).toEqual(['action','expected_version','request_id','user_id']);
});

test('someone who already holds a role here cannot be appointed and nothing is sent',async({page})=>{
 const posts=await mock(page,{candidateBody:{...candidate,role:'owner',role_name:'公会长',kept:[]}});
 await page.goto('/team');
 await page.getByLabel('任命新管理员').fill('c1@example.invalid');await page.getByRole('button',{name:'检查账户'}).click();
 const dialog=page.getByRole('alertdialog',{name:'确认任命管理员'});
 await expect(dialog).toContainText('已担任公会长');await expect(dialog.getByRole('button',{name:/确认任命/})).toHaveCount(0);
 await dialog.getByRole('button',{name:'取消'}).click();expect(posts).toEqual([]);
});

test('revoking and removing an admin each need a confirmation; cancel sends nothing',async({page})=>{
 const posts=await mock(page);
 await page.goto('/team');
 await page.getByRole('button',{name:'撤销 a1@example.invalid 的管理员职位'}).click();
 let dialog=page.getByRole('alertdialog',{name:'确认撤销管理员职位'});
 await expect(dialog).toContainText('管理员权限将立即失效');await expect(dialog).toContainText('单独设置的权限会保留');
 await dialog.getByRole('button',{name:'取消'}).click();expect(posts).toEqual([]);
 await page.getByRole('button',{name:'撤销 a1@example.invalid 的管理员职位'}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'确认撤销'}).click();
 await expect(page.getByText('已撤销管理员职位：a1@example.invalid')).toBeVisible();
 await page.getByRole('button',{name:'将 a1@example.invalid 移出本俱乐部'}).click();
 dialog=page.getByRole('alertdialog',{name:'确认移出本俱乐部'});await expect(dialog).toContainText('不影响其他俱乐部');
 await dialog.getByRole('button',{name:'确认移出'}).click();
 await expect(page.getByText('已移出本俱乐部：a1@example.invalid')).toBeVisible();
 expect(posts.map(p=>p[1].action)).toEqual(['revoke','remove']);
});

test('admin defaults: ordinary changes save at once; a sensitive opening (including back to follow) asks first; locked rows explain why',async({page})=>{
 const posts=await mock(page);
 await page.goto('/team');
 await expect(page.getByText('只有公会长可以拥有（系统安全规则）').first()).toBeVisible();
 await expect(page.getByText('超级管理员已限制管理员拥有此权限').first()).toBeVisible();
 // Not sensitive: saved without a dialog, with visible feedback.
 await page.getByLabel('管理员默认：修改俱乐部名称').selectOption('allow');
 await expect(page.getByText('已保存：管理员默认 · 修改俱乐部名称 → 允许')).toBeVisible();
 // 不允许 → 跟随全平台（允许） opens a sensitive permission: confirm, cancel keeps it unsaved.
 await page.getByLabel('管理员默认：查看操作日志').selectOption('follow');
 const dialog=page.getByRole('alertdialog',{name:'扩大敏感权限'});await expect(dialog).toContainText('跟随全平台（允许）');
 await dialog.getByRole('button',{name:'取消'}).click();expect(posts.length).toBe(1);
 await page.getByLabel('管理员默认：查看操作日志').selectOption('follow');
 await page.getByRole('alertdialog').getByRole('button',{name:'确认允许'}).click();
 await expect(page.getByText('已保存：管理员默认 · 查看操作日志 → 跟随全平台（允许）')).toBeVisible();
 expect(posts).toEqual([['/api/team/default',{permission:'club.rename',value:true}],['/api/team/default',{permission:'audit.read',value:null}]]);
});

test('per-admin tri-state shows the final result and reason; widening is judged by the final result',async({page})=>{
 const posts=await mock(page);
 await page.goto('/team');
 const list=page.locator('li',{hasText:'查看操作日志'});
 await expect(list).toContainText('原因：公会长单独禁止');
 // The Super Admin's forced deny wins: the owner sees why their allow has no effect.
 await expect(page.locator('li',{hasText:'修改俱乐部名称'})).toContainText('原因：超级管理员单独禁止（超级管理员的设置优先，你的设置暂不生效）');
 await expect(page.locator('li',{hasText:'删除某日全部数据'})).toContainText('超出该职位的权限上限');
 await expect(page.locator('li',{hasText:'任命、撤销和移出'})).toContainText('不能单独调整');
 // 单独禁止 → 跟随默认: the club default is 不允许, so nothing opens and it saves directly.
 await list.getByLabel('公会长设置').selectOption('follow');
 await expect(page.getByText('已保存：a1@example.invalid · 查看操作日志 → 跟随默认')).toBeVisible();
 // 单独允许 opens the sensitive permission: confirm first; cancel sends nothing more.
 await list.getByLabel('公会长设置').selectOption('allow');
 await page.getByRole('alertdialog',{name:'扩大敏感权限'}).getByRole('button',{name:'取消'}).click();
 expect(posts.length).toBe(1);
 await list.getByLabel('公会长设置').selectOption('allow');
 await page.getByRole('alertdialog').getByRole('button',{name:'确认允许'}).click();
 await expect(page.getByText('已保存：a1@example.invalid · 查看操作日志 → 单独允许')).toBeVisible();
 // Under a forced deny, the owner's allow is not a widening (the final result stays 不允许): no dialog.
 await page.locator('li',{hasText:'修改俱乐部名称'}).getByLabel('公会长设置').selectOption('deny');
 await expect(page.getByText('已保存：a1@example.invalid · 修改俱乐部名称 → 单独禁止')).toBeVisible();
 expect(posts).toEqual([['/api/team/personal',{user_id:a1,permission:'audit.read',value:null}],['/api/team/personal',{user_id:a1,permission:'audit.read',value:true}],['/api/team/personal',{user_id:a1,permission:'club.rename',value:false}]]);
 await page.getByRole('button',{name:'高级详情'}).click();await expect(page.getByText('club.admins.manage')).toBeVisible();
});

test('a refused grant shows the database reason and keeps the old choice',async({page})=>{
 // The owner may only grant what they hold as this club's owner (database check); the page must say so, not pretend it saved.
 const reason='不能授予你作为本俱乐部公会长没有的权限';
 await mock(page,{refuse:reason});
 await page.goto('/team');
 await page.getByLabel('管理员默认：修改俱乐部名称').selectOption('allow');
 await expect(page.getByText(`保存失败（管理员默认 · 修改俱乐部名称 → 允许）：${reason}`)).toBeVisible();
 await expect(page.getByText('已保存：')).toHaveCount(0);
});
