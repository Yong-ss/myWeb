import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000001';
test('player history shows events, null and zero without production APIs',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/**',route=>route.fulfill({json:{player:{id,display_name:'测试玩家'},timeline:[{date:'2026-10-01',revision:1,status:'present',event:'first_seen',member:{name:'测试玩家',level:null,extraordinary_score:0,weekly_activity:0},changes:null},{date:'2026-10-02',status:'left',event:'left',member:null,changes:null},{date:'2026-10-03',status:'present',event:'rejoined',member:{name:'测试玩家',extraordinary_score:50,weekly_activity:0},changes:{score:{amount:50,percent:null},activity_reset:true}}]}}));
  await page.goto(`/players?id=${id}`);await expect(page.getByRole('heading',{name:'测试玩家',exact:true})).toBeVisible();await expect(page.locator('.club-events')).toContainText('重新加入');await expect(page.getByRole('cell',{name:'0',exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('player.png'),fullPage:true});
});
