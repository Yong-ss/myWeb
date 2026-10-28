import {test,expect} from '@playwright/test';
for(const width of [1440,390,320])test(`roster area chart pointer, keyboard and stable tooltip ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/**',r=>{
  const u=new URL(r.request().url());if(u.pathname==='/api/account')return r.fulfill({json:{email:'chart@example.invalid',role:'owner'}});if(u.pathname==='/api/club-settings')return r.fulfill({json:{name:'测试俱乐部'}});
  const prior=u.searchParams.has('date');return r.fulfill({json:{snapshot:{snapshot_date:prior?'2026-10-27':'2026-10-28',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-28'},{snapshot_date:'2026-10-27'}],members:[],snapshot_count:prior?71:79}});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/account');const chart=page.getByRole('figure',{name:'人数总览趋势图'});const first=chart.getByRole('button',{name:'2026-10-27，记录人数 71 人'}),last=chart.getByRole('button',{name:'2026-10-28，记录人数 79 人'});
 await expect(page.getByRole('heading',{name:'人数总览',exact:true})).toBeVisible();await expect(page.getByText('记录人数不等于实际在会人数。',{exact:true})).toHaveCount(0);
 await expect(first).toBeVisible();await expect(first).toHaveCSS('border-top-style','none');await expect(first).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await first.focus();await expect(chart.getByRole('tooltip')).toContainText('71');const size=await chart.boundingBox();
 await page.keyboard.press('Tab');await expect(last).toBeFocused();await expect(chart.getByRole('tooltip')).toContainText('79');await page.keyboard.press('Escape');await expect(chart.getByRole('tooltip')).toHaveCount(0);
 await last.hover();await expect(chart.getByRole('tooltip')).toContainText('2026-10-28');expect(await chart.boundingBox()).toEqual(size);await chart.screenshot({path:`.test-artifacts/chart-${width}.png`});
 const tip=await chart.getByRole('tooltip').boundingBox();expect(tip.x).toBeGreaterThanOrEqual(0);expect(tip.x+tip.width).toBeLessThanOrEqual(width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(last.locator('span')).toHaveCSS('transition-duration','0s');
});
test.describe('touch chart',()=>{test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});test('tap shows a real zero count on a single observation',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/account'?{email:'touch@example.invalid',role:'owner'}:{snapshot:{snapshot_date:'2026-10-28',is_complete_roster:true},snapshots:[{snapshot_date:'2026-10-28'}],members:[],snapshot_count:0}}));
 await page.goto('/account');const chart=page.getByRole('figure');await chart.getByRole('button',{name:'2026-10-28，记录人数 0 人'}).tap();await expect(chart.getByRole('tooltip')).toContainText('0');expect(await chart.locator('.club-chart-line').count()).toBe(0);
});});
