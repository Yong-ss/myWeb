import {test,expect} from '@playwright/test';
import {ownerAccount} from './fixtures.mjs';
for(const width of [1440,390])test(`overview and analytics navigation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});let comparisons=0;
 await page.route('**/api/**',r=>{
 const u=new URL(r.request().url());if(u.pathname==='/api/account')return r.fulfill({json:ownerAccount('test@example.invalid')});if(u.pathname==='/api/club-settings')return r.fulfill({json:{name:'测试俱乐部'}});
 if(u.searchParams.has('trend'))return r.fulfill({json:{points:[{date:'2026-10-29',score:100,partial:false,missing:0},{date:'2026-10-30',score:120,partial:false,missing:0}],next:null}});
 const prior=u.searchParams.has('date');if(prior)comparisons++;
 return r.fulfill({json:{snapshot:{snapshot_date:prior?'2026-10-29':'2026-10-30',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-30'},{snapshot_date:'2026-10-29'}],members:[{player_id:'p',name:'成员',presence:'present',pathway:'观众',extraordinary_score:prior?100:120}],next:null}});
 });
 await page.goto('/account');
 await expect(page.getByRole('region',{name:'俱乐部近况'})).toContainText('明确在会');
 await expect(page.getByRole('main')).toContainText('已确认完整');
 await expect(page.getByText('共同成员评分成长',{exact:true})).toHaveCount(0);
 for(const label of ['总评分','前 30 人总评分','所有成员平均评分']){
  await expect(page.getByRole('region',{name:'俱乐部近况'}).getByText(label,{exact:true}).locator('..')).toContainText('120');
 }
 await expect(page.getByRole('region',{name:'最近值得关注'})).toContainText('共同成员整体变强');
 await expect(page.getByRole('region',{name:'俱乐部总评分趋势'})).toBeVisible();
 await page.screenshot({path:'.test-artifacts/overview-'+width+'.png',fullPage:true});
 const before=comparisons;await page.goto('/analytics?view=pathways');
 await expect(page.getByRole('region',{name:'途径分布'})).toBeVisible();
 await page.reload();await expect(page.getByRole('region',{name:'途径分布'})).toBeVisible();expect(comparisons).toBe(before);
 await page.goto('/analytics?view=growth');await expect(page).toHaveURL(/\/account/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
