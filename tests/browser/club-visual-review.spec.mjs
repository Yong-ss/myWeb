import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

const id='00000000-0000-4000-8000-000000000001';
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
    const json=url.pathname==='/api/account'?{email:'archive@example.invalid',role:'owner'}:
      url.pathname==='/api/club-settings'?{name:'灰雾档案馆 · 测试',can_edit:true}:
      url.pathname==='/api/activity'?{events:[{id,actor_id:null,actor_label:'超级管理员',actor_kind:'super_admin',actor_role:null,created_at:'2026-10-28T12:00:00Z',action:'import_date_deleted',details:{date:'2026-10-27',versions:2}}],next:null}:
      url.pathname==='/api/import-context'?{players:[],snapshot:null,members:[]}:
      url.searchParams.has('player')?{player:{id,display_name:'档案成员1'},timeline:[{date:'2026-10-28',revision:1,status:'present',event:'first_seen',member:members[0],changes:null}]}:
      {snapshot,snapshots:[snapshot],members,next:null,snapshot_count:8};
    return route.fulfill({json});
  });
  for(const [name,path] of [['home','/'],['login','/login'],['dashboard','/account'],['members','/members'],['player',`/players?id=${id}`],['import','/import'],['activity','/activity'],['settings','/settings'],['404','/404.html']]){
    await page.goto(path);await page.waitForLoadState('networkidle');
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must fit the viewport`).toBe(true);
    await page.screenshot({path:`.test-artifacts/club-review/${name}-${width}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
