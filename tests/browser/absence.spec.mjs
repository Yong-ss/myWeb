import {test,expect} from '@playwright/test';
import {mockApp,prepare} from './fixtures.mjs';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
for(const width of [1440,390])test(`absence choices, partial merge and completeness stay consistent ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mockApp(page);state.signedIn=true;
 await page.route('**/api/import-context*',r=>r.fulfill({json:{players:[{id:a,display_name:'冷月'},{id:b,display_name:'缺席乙'}],snapshot:{id:a,revision:1,is_complete_roster:false},members:[{player_id:a,name:'冷月'},{player_id:b,name:'缺席乙'}],absence_context:{snapshot:{id:a,snapshot_date:'2026-10-26'},members:[{player_id:a,name:'冷月'},{player_id:b,name:'缺席乙'}]}}}));
 await prepare(page);await page.locator('.identity-launcher').first().click();const d=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});await d.getByRole('button',{name:'选择已有玩家',exact:true}).click();await d.getByRole('button',{name:/^冷月/}).click();await d.getByRole('button',{name:'确认',exact:true}).click();
 await page.getByRole('radio',{name:/^只补充／修正部分玩家/}).check();await expect(page.locator('.absence-review')).toHaveCount(0);
 await page.getByRole('radio',{name:/^重新导入整份名单/}).check();await expect(page.getByRole('heading',{name:'核对缺席成员 · 1 人'})).toBeVisible();await expect(page.getByRole('button',{name:'下一步 →',exact:true})).toBeDisabled();
 await page.getByRole('group',{name:'缺席乙',exact:true}).getByRole('radio',{name:'不确定，稍后确认',exact:true}).check();await page.screenshot({path:`.test-artifacts/absence-${width}.png`,fullPage:true});await page.getByRole('button',{name:'下一步 →',exact:true}).click();await expect(page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'← 返回核对，继续修改',exact:true}).click();await page.getByRole('group',{name:'缺席乙',exact:true}).getByRole('radio',{name:'确认退会',exact:true}).check();await page.getByRole('button',{name:'下一步 →',exact:true}).click();await expect(page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true})).toBeEnabled();
 await page.getByRole('checkbox',{name:/我已核对名单/}).check();await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');expect(state.submissions[0].absence_decisions).toEqual([{player_id:b,decision:'left'}]);expect(state.submissions[0].baseline_snapshot_id).toBe(a);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
