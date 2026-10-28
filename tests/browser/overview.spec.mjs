import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`overview progressively renders without waiting for account or comparison ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let account,latest,prior;
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/account'){account=route;return;}
  if(url.pathname==='/api/club-settings')return route.fulfill({json:{name:'测试俱乐部'}});
  if(url.searchParams.has('date')){prior=route;return;}
  latest=route;
 });
 await page.goto('/account');await expect(page.getByLabel('总览数据加载中')).toBeVisible();
 await expect.poll(()=>Boolean(account&&latest)).toBe(true);
 const frame=await page.locator('.club-overview-counts').boundingBox();
 const ranking=await page.locator('.club-overview-ranking').boundingBox();
 await latest.fulfill({json:{snapshot:{snapshot_date:'2026-10-28',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-28'},{snapshot_date:'2026-10-27'}],members:[{player_id:'a',name:'当前排名成员',presence:'present',extraordinary_score:20}]}});
 await expect(page.getByRole('link',{name:'当前排名成员'})).toBeVisible();
 expect(await page.locator('.club-overview-counts').boundingBox()).toEqual(frame);
 expect(await page.locator('.club-overview-ranking').boundingBox()).toEqual(ranking);
 await expect(page.getByRole('figure',{name:'人数总览趋势图'})).toBeVisible();
 await expect(page.getByRole('status')).toHaveText('正在读取对比…');
 await expect(page.getByText('首次记录，暂无对比',{exact:false})).toHaveCount(0);
 await expect.poll(()=>Boolean(prior)).toBe(true);
 await account.fulfill({json:{email:'progress@example.invalid',role:'owner'}});
 await prior.fulfill({status:503,json:{error:'对比数据暂不可用'}});
 await expect(page.getByRole('button',{name:'重试对比'})).toBeVisible();
 await expect(page.getByRole('link',{name:'当前排名成员'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [1440,390])test(`overview replaces task cards ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/account')return route.fulfill({json:{email:'dashboard@example.invalid',role:'owner'}});const prior=u.searchParams.has('date');return route.fulfill({json:{snapshot:{snapshot_date:prior?'2026-10-27':'2026-10-28',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-28'},{snapshot_date:'2026-10-27'}],members:prior?[{player_id:'a',name:'老成员',presence:'present',extraordinary_score:10}]:[{player_id:'a',name:'老成员',presence:'left',extraordinary_score:10},{player_id:'b',name:'新成员',presence:'present',extraordinary_score:20}],snapshot_count:1}});});
 await page.goto('/account');await expect(page.getByRole('heading',{name:'非凡评分前十'})).toBeVisible();await expect(page.locator('.club-header-account')).toContainText('dashboard@example.invalid');await expect(page.locator('.club-brand-subtitle')).toHaveText('数据检测平台');await expect(page.getByRole('link',{name:'开始导入'})).toHaveCount(0);await expect(page.getByRole('main')).toContainText('首次出现：新成员');await expect(page.getByRole('main')).toContainText('暂时离会：老成员');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('overview.png'),fullPage:true});
});
