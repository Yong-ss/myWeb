import {test,expect} from '@playwright/test';
// Stage G screens: removal from every club, plain permission names, and the alliance leader's forced deny. Mocks follow
// the real Worker contract; the database decides what is real.
const X='00000000-0000-4000-8000-0000000000a1',Y='00000000-0000-4000-8000-0000000000b2',Z='00000000-0000-4000-8000-0000000000c3',U='00000000-0000-4000-8000-0000000000aa',L='00000000-0000-4000-8000-0000000000bb';
const sa={email:'boss@example.invalid',club_id:X,roles:[],permissions:[],super_admin:true,mfa_verified:true,mfa_session:true,platform_admin:false,alliance_leader:false,
 platform_permissions:['platform.alliance_leaders.assign','platform.alliances.manage','platform.clubs.admin_limit','platform.permissions.manage','platform.platform_admins.assign','platform.read','platform.roles.assign','platform.users.remove_all_clubs'],clubs:[]};
const users=[
 {id:U,email:'member@example.invalid',email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,super_admin:false,platform_admin:false,alliance:null,
  memberships:[{club_id:X,club_name:'甲俱乐部',role:'admin',role_name:'管理员',status:'active'},{club_id:Y,club_name:'乙俱乐部',role:'owner',role_name:'公会长',status:'active'}],
  effective:[{club_id:X,club_name:'甲俱乐部',permissions:['imports.create','members.read']}]},
 {id:L,email:'leader@example.invalid',email_confirmed:true,created_at:'2026-10-01T00:00:00Z',last_sign_in_at:null,super_admin:false,platform_admin:false,
  alliance:{id:Z,name:'晨星联盟',clubs:[{club_id:Z,club_name:'丙俱乐部'}]},memberships:[],effective:[]}];
async function mock(page,{owner=true,conflict=false}={}){
 const writes=[];
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  if(route.request().method()==='POST'){writes.push([url.pathname,route.request().postDataJSON()]);
   if(url.pathname==='/api/admin/remove-from-all-clubs'&&conflict)return json({error:'职位已变化，请刷新后重新核对；本次没有移出任何俱乐部。'},409);
   return json(url.pathname==='/api/admin/remove-from-all-clubs'?{changed:true,clubs:[{name:'甲俱乐部'}]}:{changed:true});}
  if(url.pathname==='/api/account')return json(sa);
  if(url.pathname==='/api/admin/overview')return json({totals:{clubs:3,users:2,confirmed_users:2,members:1,active_roles:2},alliances:1,clubs:[]});
  if(url.pathname==='/api/admin/users')return json({users:[{...users[0],memberships:owner?users[0].memberships:users[0].memberships.slice(0,1)},users[1]],next:null});
  if(url.pathname==='/api/admin/role-context')return json({clubs:[{id:X,name:'甲俱乐部',role_version:7,admin_limit:5,admins:1,owner_id:null},{id:Y,name:'乙俱乐部',role_version:2,admin_limit:5,admins:0,owner_id:U}],
   memberships:[{club_id:X,role:'admin',status:'active'},...(owner?[{club_id:Y,role:'owner',status:'active'}]:[])]});
  if(url.pathname==='/api/admin/permission-explain')return json({club_id:Z,user_id:L,role:null,role_name:null,email_confirmed:true,alliance_leader:true,
   permissions:[{key:'members.read',description:'查看成员名单、个人档案、评分与分析',sensitive:false,non_delegable:false,layer:'no_role',allowed:true,alliance:true,platform_default:false,cap_blocked:false,club_default:null,forced:null,owner_set:null},
    {key:'imports.create',description:'导入每日数据并更正昵称',sensitive:false,non_delegable:false,layer:'no_role',allowed:false,alliance:false,platform_default:false,cap_blocked:false,club_default:null,forced:null,owner_set:null}]});
  return json({events:[],next:null});
 });
 return writes;
}
const usersTab=async page=>{await page.goto('/admin');await page.getByRole('tab',{name:'用户与职位'}).click();};

for(const width of [1440,390])test(`effective permissions are plain Chinese; codes only under advanced details ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await mock(page);await usersTab(page);
 const row=page.getByRole('row',{name:/member@example.invalid/});
 await expect(row).toContainText('导入每日数据并更正昵称');await expect(row).not.toContainText('imports.create');
 await row.getByRole('button',{name:'member@example.invalid 的权限代码'}).click();await expect(row).toContainText('imports.create');
 await expect(page.getByText('联盟会长 · 晨星联盟')).toBeVisible();await expect(page.getByText(/联盟只读：丙俱乐部/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`users-${width}.png`)});
});

test('removal from every club: preview, owner blocks the whole removal, nothing is sent',async({page})=>{
 const writes=await mock(page);await usersTab(page);
 await page.getByRole('button',{name:'把 member@example.invalid 移出全部俱乐部'}).click();
 const dialog=page.getByRole('alertdialog');const list=dialog.getByRole('list',{name:'将受影响的俱乐部'});
 await expect(list.getByRole('listitem')).toHaveCount(2);await expect(list).toContainText('甲俱乐部');await expect(list).toContainText('不能直接移出');
 await expect(dialog.getByRole('alert')).toContainText('请先在「管理职位」里转让公会长');
 await expect(dialog.getByRole('button',{name:/确认移出/})).toBeDisabled();
 await dialog.getByRole('button',{name:'取消'}).click();expect(writes).toEqual([]);
});

for(const width of [1440,390])test(`removal from every club sends exactly the previewed versions; a conflict asks to refresh ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 let writes=await mock(page,{owner:false});await usersTab(page);
 await page.getByRole('button',{name:'把 member@example.invalid 移出全部俱乐部'}).click();
 const dialog=page.getByRole('alertdialog');await expect(dialog).toContainText('账户本身、历史记录、操作日志和个人权限设置都会保留');
 const confirm=dialog.getByRole('button',{name:'确认移出 1 个俱乐部'});await expect(confirm).toBeEnabled();
 // Measured once the opening scale animation has settled (min-h-11 = 44px touch target).
 await expect.poll(async()=>(await confirm.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await expect(dialog).toHaveCSS('opacity','1');await page.screenshot({path:info.outputPath(`remove-${width}.png`)});
 await confirm.click();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0][0]).toBe('/api/admin/remove-from-all-clubs');expect(writes[0][1]).toMatchObject({user_id:U,expected:{[X]:7}});expect(writes[0][1].request_id).toMatch(/^[0-9a-f-]{36}$/);
 await expect(page.getByText('已把 member@example.invalid 移出 1 个俱乐部')).toBeVisible();
 // Conflict: the dialog stays open, says nothing was removed, and offers a refresh instead of a second blind confirm.
 await page.context().unrouteAll({behavior:'ignoreErrors'});writes=await mock(page,{owner:false,conflict:true});await usersTab(page);
 await page.getByRole('button',{name:'把 member@example.invalid 移出全部俱乐部'}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'确认移出 1 个俱乐部'}).click();
 await expect(page.getByRole('alertdialog')).toContainText('本次没有移出任何俱乐部');
 await expect(page.getByRole('alertdialog').getByRole('button',{name:'刷新'})).toBeVisible();
});

test('a leader without a club role can be given a forced deny on an alliance read, and only a deny',async({page})=>{
 const writes=await mock(page);await usersTab(page);
 await page.getByRole('button',{name:'查看 leader@example.invalid 的权限'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('此账户是该俱乐部所属联盟的会长');
 await expect(dialog).toContainText('原因：联盟会长只读');await expect(dialog).toContainText('联盟会长只读允许');
 const select=dialog.getByLabel('超级管理员设置');await expect(select).toHaveCount(1); // only the alliance read, never the write
 await expect(select.locator('option')).toHaveText(['跟随联盟只读（允许）','单独禁止']);
 await select.selectOption('deny');
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual(['/api/admin/personal-permission',{club_id:Z,user_id:L,permission:'members.read',value:false}]);
});
