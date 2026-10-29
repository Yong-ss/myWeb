import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`overview and analytics navigation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});let comparisons=0;
 await page.route('**/api/**',r=>{
 const u=new URL(r.request().url());if(u.pathname==='/api/account')return r.fulfill({json:{email:'test@example.invalid',role:'owner'}});if(u.pathname==='/api/club-settings')return r.fulfill({json:{name:'测试俱乐部'}});
 const prior=u.searchParams.has('date');if(prior)comparisons++;
 return r.fulfill({json:{snapshot:{snapshot_date:prior?'2026-10-29':'2026-10-30',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-30'},{snapshot_date:'2026-10-29'}],members:[{player_id:'p',name:'成员',presence:'present',pathway:'观众',extraordinary_score:prior?100:120}],next:null}});
 });
 await page.goto('/account');
 await expect(page.getByRole('region',{name:'俱乐部近况'})).toContainText('明确在会');
 await expect(page.getByRole('main')).toContainText('已确认完整');
 await expect(page.getByRole('main')).toContainText('既有成员已知评分净变化 +20');
 await expect(page.getByRole('region',{name:'非凡评分成长分析'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'途径分布'})).toHaveCount(0);
 await page.screenshot({path:'.test-artifacts/overview-phase4-'+width+'.png',fullPage:true});
 await page.getByRole('link',{name:'查看途径分布',exact:true}).click();
 await expect(page).toHaveURL(/view=pathways/);
 await expect(page.getByRole('region',{name:'途径分布'})).toBeVisible();
 const before=comparisons;await page.reload();
 await expect(page.getByRole('region',{name:'途径分布'})).toBeVisible();expect(comparisons).toBe(before);
 await page.getByRole('tab',{name:'实力成长',exact:true}).click();
 await expect(page).toHaveURL(/view=growth/);
 await expect(page.getByRole('region',{name:'非凡评分成长分析'}).locator('strong').filter({hasText:'+20'})).toBeVisible();
 await expect(page.getByLabel('比较起始日期')).toHaveCount(0);
 await expect(page.getByLabel('成长榜筛选')).toHaveCount(0);
 await page.screenshot({path:'.test-artifacts/analytics-phase4-'+width+'.png',fullPage:true});
 await page.goBack();await expect(page.getByRole('tab',{name:'途径分布',exact:true})).toHaveAttribute('aria-selected','true');
 await page.goForward();await expect(page.getByRole('tab',{name:'实力成长',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('analytics keeps top five compact and exposes full sorting with contextual warnings',async({page})=>{
 let fail=false,empty=false;
 await page.route('**/api/**',r=>{
  const u=new URL(r.request().url());
  if(!u.pathname.includes('/api/members'))return r.fulfill({json:{name:'测试俱乐部',role:'owner'}});
  if(fail)return r.fulfill({status:503,json:{error:'读取失败测试'}});
  const prior=u.searchParams.has('date');
  return r.fulfill({json:{snapshot:empty?null:{snapshot_date:prior?'2026-10-29':'2026-10-30',is_complete_roster:false},snapshots:[{snapshot_date:'2026-10-30'},{snapshot_date:'2026-10-29'}],members:Array.from({length:8},(_,i)=>({player_id:String(i),name:`玩家${i}`,presence:'present',extraordinary_score:prior?100:100+i})),next:null}});
 });
 await page.goto('/analytics?view=growth');
 const card=page.getByRole('region',{name:'非凡评分成长分析'});
 await expect(card.getByRole('table').locator('tbody tr')).toHaveCount(5);
 await expect(card).toContainText('名单未确认完整或存在缺失评分');
 await card.getByRole('button',{name:'查看全部',exact:true}).click();
 await expect(card.getByRole('table').locator('tbody tr')).toHaveCount(8);
 await card.getByLabel('排序方式').selectOption('decline');
 await expect(card.getByRole('table').locator('tbody tr').first()).toContainText('玩家0');
 empty=true;await page.reload();await expect(page.getByText('还没有每日记录')).toBeVisible();
 fail=true;await page.reload();await expect(page.getByText('读取失败测试',{exact:true})).toBeVisible();
});
