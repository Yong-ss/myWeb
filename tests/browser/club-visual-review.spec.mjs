import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {ownerAccount,ownerPermissions} from './fixtures.mjs';

const id='00000000-0000-4000-8000-000000000001';
for(const width of [1440,390])test(`dragon pathway search visual review ${width}`,async({page})=>{
 mkdirSync('.test-artifacts/club-review',{recursive:true});
 await page.setViewportSize({width,height:900});
 const players=[{player_id:id,display_name:'测试观众',read_name:'截图旧昵称',pathway:'观众'},{player_id:id.slice(0,-1)+'2',display_name:'测试战士',read_name:null,pathway:'战士'},{player_id:id.slice(0,-1)+'3',display_name:'未知途径玩家',read_name:null,pathway:null}];
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:8791')return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  return route.fulfill({json:u.pathname==='/api/account'?ownerAccount('test@example.invalid',{permissions:['dragon.read'],club_id:id,clubs:[{id,name:'测试俱乐部',roles:['owner']}]}):u.pathname==='/api/club-settings'?{name:'测试俱乐部'}:{event:{id,event_date:'2026-11-06',status:'active',version:1},players,roster:{date:'2026-11-06',revision:2,complete:false},absent:[{player_id:id.slice(0,-1)+'4',display_name:'当天未参加成员',pathway:'学徒'}]}});
 });
 await page.goto(`/dragon/event?id=${id}&club=${id}&player=${id}`);
 await expect(page.getByRole('heading',{name:'2026-11-06 猎龙'})).toBeVisible();
 await expect(page.getByRole('link',{name:'当天未参加成员 学徒',exact:true})).toBeVisible();
 await expect(page.getByText('当天名单不完整，以下只列出已录入名单中未参加的人。',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'观众',exact:true}).getByRole('link',{name:'测试观众',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'未识别途径',exact:true})).toBeVisible();
 await expect(page.getByText('截图上的名字',{exact:true})).toHaveCount(0);
 await expect(page.getByText('截图旧昵称',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`.test-artifacts/club-review/dragon-${width}.png`,fullPage:true});
 await page.getByLabel('搜索参加者').fill('截图旧昵称');
 await expect(page.getByRole('status')).toContainText('显示 1 / 3 人');
 await expect(page.getByRole('link',{name:'测试战士',exact:true})).toHaveCount(0);
 await page.getByLabel('搜索参加者').fill('战士');
 await expect(page.getByRole('link',{name:'测试战士',exact:true})).toBeVisible();
 await page.getByLabel('搜索参加者').fill('不存在');
 await expect(page.getByText('没有找到参加者',{exact:true})).toBeVisible();
 await page.getByLabel('搜索参加者').fill('');
 await expect(page.getByRole('status')).toContainText('显示 3 / 3 人');
});
const snapshot={id,snapshot_date:'2026-10-28',revision:1,is_current:true,is_complete_roster:true};
const members=Array.from({length:8},(_,i)=>({player_id:i?id.slice(0,-1)+(i+1):id,name:`档案成员${i+1}`,position:'正式会员',level:70+i,pathway:'观众',extraordinary_score:14000+i*97,prosperity:1600+i*10,weekly_activity:i?120:0,group_name:'第一组',join_days:35+i,presence:'present'}));
for(const width of [1440,390])test(`whole Club visual review ${width}`,async({page})=>{
  mkdirSync('.test-artifacts/club-review',{recursive:true});
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://127.0.0.1:8791')return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    const json=url.pathname==='/api/account'?ownerAccount('archive@example.invalid',{permissions:[...ownerPermissions,'events.read','highland.read'],club_id:id,clubs:[{id,name:'灰雾档案馆 · 测试',roles:['owner']}],super_admin:true,mfa_verified:true,mfa_session:true,platform_permissions:['platform.read']}):
      url.pathname==='/api/admin/overview'?{totals:{clubs:1,users:1,confirmed_users:1,members:1,active_roles:1},alliances:null,clubs:[{id,name:'灰雾档案馆 · 测试',members:1,players:86,latest_snapshot:snapshot.snapshot_date,is_complete_roster:true,player_counts:{present:64,temporary:3,confirmed_left:8,unconfirmed:7,other_left:4}}]}:
      url.pathname==='/api/club-settings'?{name:'灰雾档案馆 · 测试',can_edit:true}:
      url.pathname==='/api/activity'?{events:[{id,actor_id:null,actor_label:'超级管理员',actor_kind:'super_admin',actor_role:null,created_at:'2026-10-28T12:00:00Z',action:'import_date_deleted',details:{date:'2026-10-27',versions:2}}],next:null}:
      url.pathname==='/api/import-context'?{players:[],snapshot:null,members:[]}:
      url.searchParams.has('player')?{player:{id,display_name:'档案成员1'},timeline:[{date:'2026-10-28',revision:1,status:'present',event:'first_seen',member:members[0],changes:null}]}:
      {snapshot,snapshots:[snapshot],members,next:null,snapshot_count:8};
    return route.fulfill({json});
  });
  for(const [name,path] of [['home','/'],['login','/login'],['dashboard','/account'],['members','/members'],['player',`/players?id=${id}`],['import','/import'],['activity','/activity'],['settings','/settings'],['404','/404.html'],['admin','/admin']]){
    await page.goto(path);await page.waitForLoadState('networkidle');
    await expect(page.getByRole('main')).toBeVisible();
    if(name==='members'){
      await expect(page.getByRole('main').getByRole('link',{name:'导入数据',exact:true})).toBeVisible();
      if(width===390)await page.getByRole('button',{name:'菜单'}).click();
      const nav=page.getByRole('navigation',{name:'俱乐部导航'}).filter({visible:true});
      await expect(nav.getByRole('link',{name:'导入数据',exact:true})).toHaveCount(0);
      for(const group of ['日常数据','活动','管理'])await expect(nav.getByText(group,{exact:true})).toBeVisible();
      await expect(nav.getByRole('link',{name:'四方联赛',exact:true})).toBeVisible();
      await expect(nav.getByRole('link',{name:'高原竞逐',exact:true})).toBeVisible();
      await page.screenshot({path:`.test-artifacts/club-review/navigation-${width}.png`,fullPage:true});
      if(width===390)await page.getByRole('button',{name:'关闭菜单'}).click();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must fit the viewport`).toBe(true);
    await page.screenshot({path:`.test-artifacts/club-review/${name}-${width}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
