import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000001',date='2026-10-28';
for(const width of [1440,390])test(`delete confirmation, retry, audit list and empty state ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});let deleted=false,attempts=0,logAttempts=0;
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/account')return route.fulfill({json:{email:'owner@example.invalid',role:'owner'}});
  if(url.pathname==='/api/club-settings')return route.fulfill({json:{name:'测试俱乐部'}});
  if(url.pathname==='/api/delete-import'){attempts++;return route.fulfill(attempts===1?{status:502,json:{error:'连接失败，请重试'}}:(deleted=true,{json:{deleted:true}}));}
  if(url.pathname==='/api/activity'){
   logAttempts++;if(logAttempts===1)return route.fulfill({status:502,json:{error:'日志读取失败'}});
   return route.fulfill({json:{events:logAttempts===2?[{id,actor_id:id,created_at:'2026-10-28T12:00:00Z',action:'import_date_deleted',details:{date,versions:2,actor_email:'owner@example.invalid',actor_role:'owner'}}]:[],next:logAttempts===2?{before:'2026-10-28T12:00:00Z',id}:null}});
  }
  return route.fulfill({json:{snapshot:deleted?null:{id,snapshot_date:date,revision:2,is_current:true,is_complete_roster:true},snapshots:deleted?[]:[{id,snapshot_date:date}],members:[],next:null}});
 });
 await page.goto('/members');await page.getByRole('button',{name:'删除当天数据',exact:true}).click();const dialog=page.getByRole('alertdialog');
 await expect(dialog.getByRole('button',{name:'确认删除',exact:true})).toBeDisabled();
 await dialog.getByLabel(`输入日期 ${date} 确认`).fill(date);await page.screenshot({path:`.test-artifacts/delete-${width}.png`});
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('连接失败');
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('heading',{name:'还没有保存记录'})).toBeVisible();expect(attempts).toBe(2);
 await page.goto('/activity');await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('cell',{name:'删除当天数据',exact:true})).toBeVisible();
 await page.screenshot({path:`.test-artifacts/activity-${width}.png`});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'更早记录',exact:true}).click();await expect(page.getByRole('button',{name:'更早记录',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'暂无操作记录',exact:true})).toBeVisible();
});
