import {test,expect} from '@playwright/test';
import {ownerAccount,ownerPermissions,id} from './fixtures.mjs';
// Stage F screens. Mocks follow the real Worker contract; the database decides what is real. These check that each
// identity is offered only what it may do, in plain Chinese, and that writes send exactly what the Worker expects.
const X='00000000-0000-4000-8000-0000000000a1',Y='00000000-0000-4000-8000-0000000000b2',R='00000000-0000-4000-8000-0000000000c3',AL='00000000-0000-4000-8000-0000000000d4';
const leader={email:'leader@example.invalid',club_id:id,roles:[],permissions:[],super_admin:false,mfa_verified:false,mfa_session:false,platform_admin:false,alliance_leader:true,platform_permissions:[],clubs:[]};
const snapshot={id:X,snapshot_date:'2026-10-30',revision:1,is_current:true,is_complete_roster:true};
async function mock(page,{account,writes=[]}){
 await page.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(test.info().project.use.baseURL??'http://127.0.0.1:8791').origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const json=(body,status=200)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
  const club=url.searchParams.get('club');
  if(route.request().method()==='POST'){writes.push([url.pathname+(club?`?club=${club}`:''),route.request().postDataJSON()]);return json({changed:true});}
  if(url.pathname==='/api/account')return json(typeof account==='function'?account(club):account);
  if(url.pathname==='/api/alliance')return json({alliance:{id:AL,name:'晨星联盟'},clubs:[{id:X,name:'甲俱乐部'},{id:Y,name:'乙俱乐部'}],requests:[{id:R,club_id:id,club_name:'丙俱乐部',created_at:'2026-11-01T08:00:00Z'}]});
  if(url.pathname==='/api/club-settings')return json({name:club===X?'甲俱乐部':'丙俱乐部',can_edit:false});
  if(url.pathname==='/api/club-alliance')return json({alliance:null,request:null,alliances:[{id:AL,name:'晨星联盟'}]});
  if(url.pathname==='/api/members')return json({snapshots:[snapshot],snapshot,next:null,members:[{player_id:X,name:'甲成员',presence:'unconfirmed',level:70}]});
  if(url.pathname==='/api/admin/overview')return json({totals:{clubs:2,users:3,confirmed_users:3,members:2,active_roles:2},alliances:1,clubs:[]});
  if(url.pathname==='/api/admin/alliances')return json({alliances:[{id:AL,name:'晨星联盟',status:'active',leader:null,clubs:[{id:X,name:'甲俱乐部'}],pending:1}],clubs:[{id:X,name:'甲俱乐部',alliance_id:AL},{id:Y,name:'乙俱乐部',alliance_id:null}]});
  return json({snapshot:null,snapshots:[],members:[],points:[],next:null,events:[]});
 });
 return writes;
}

for(const width of [1440,390])test(`a leader without a club role lands in the alliance workspace and approves with a confirmation ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const writes=await mock(page,{account:leader});
 await page.goto('/login');await expect(page).toHaveURL(/\/alliance$/);
 await expect(page.getByRole('heading',{name:'晨星联盟',level:1})).toBeVisible();
 await expect(page.locator('.club-header-account')).toContainText('联盟会长');await expect(page.locator('.club-brand-subtitle')).toHaveText('联盟工作空间');
 await expect(page.getByRole('link',{name:'查看甲俱乐部'})).toHaveAttribute('href',`/account?club=${X}`);
 await expect(page.getByText('原始导入内容和操作人邮箱不会显示')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`alliance-${width}.png`)});
 await page.getByRole('button',{name:'批准',exact:true}).click();
 const dialog=page.getByRole('alertdialog');await expect(dialog).toContainText('只读查看');await dialog.getByRole('button',{name:'取消'}).click();expect(writes).toEqual([]);
 await page.getByRole('button',{name:'批准',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认批准'}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual(['/api/alliance/decide',{request_id:R,decision:'approve'}]);
});

test('in an alliance club the leader sees data but no writing tools',async({page})=>{
 await mock(page,{account:club=>({...leader,club_id:club??id,permissions:club===X?['audit.read','members.read']:[]})});
 await page.goto(`/members?club=${X}`);await expect(page.getByRole('link',{name:'甲成员'})).toBeVisible();
 for(const name of ['导入数据','删除当天数据'])await expect(page.getByRole('link',{name}).or(page.getByRole('button',{name}))).toHaveCount(0);
 await expect(page.getByRole('button',{name:/处理/})).toHaveCount(0);
 const nav=page.locator('.club-sidebar');await expect(nav.getByRole('link',{name:'操作日志'})).toBeVisible();
 await expect(nav.getByRole('link',{name:'导入数据'})).toHaveCount(0);await expect(nav.getByRole('link',{name:'管理员管理'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'我的联盟'})).toBeVisible();
 await expect(page.locator('.club-user-name small')).toHaveText('联盟会长（只读）');
});

test('the owner requests to join an alliance from the club settings',async({page})=>{
 const writes=await mock(page,{account:ownerAccount('owner@example.invalid')});
 await page.goto(`/settings?club=${id}`);
 const card=page.locator('[data-slot="card"]',{hasText:'所属联盟'});await expect(card).toContainText('还没有加入联盟');
 await card.getByLabel('选择联盟').selectOption(AL);await card.getByRole('button',{name:'申请加入'}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual([`/api/club-alliance?club=${id}`,{action:'request',alliance_id:AL}]);
 // An admin (no request permission) does not see the card.
 await page.unrouteAll({behavior:'ignoreErrors'});await page.context().unrouteAll({behavior:'ignoreErrors'});
 await mock(page,{account:ownerAccount('admin@example.invalid',{roles:['admin'],permissions:ownerPermissions.filter(p=>!p.startsWith('club.'))})});
 await page.goto(`/settings?club=${id}`);await expect(page.getByText('俱乐部名称').first()).toBeVisible();await expect(page.getByText('所属联盟')).toHaveCount(0);
});

test('an active platform admin manages alliances, club placement and leaders',async({page})=>{
 const writes=await mock(page,{account:{...leader,email:'pa@example.invalid',alliance_leader:false,platform_admin:true,mfa_session:true,platform_permissions:['platform.alliance_leaders.assign','platform.alliances.manage','platform.read','platform.roles.assign']}});
 await page.goto('/admin');await page.getByRole('tab',{name:'联盟'}).click();
 await expect(page.getByText('1 个待处理申请')).toBeVisible();
 await page.getByLabel('新建联盟').fill('暮光联盟');await page.getByRole('button',{name:'创建'}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual(['/api/admin/alliance',{alliance_id:null,name:'暮光联盟',status:'active'}]);
 await page.getByLabel('任命会长（邮箱）').fill('leader@example.invalid');await page.getByRole('button',{name:'任命',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(['/api/admin/alliance-leader',{alliance_id:AL,email:'leader@example.invalid',action:'grant'}]);
 await page.getByLabel('乙俱乐部所属联盟').selectOption(AL);
 await expect.poll(()=>writes.length).toBe(3);expect(writes[2]).toEqual(['/api/admin/club-alliance',{club_id:Y,alliance_id:AL}]);
});
