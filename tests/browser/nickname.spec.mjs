import {test,expect} from '@playwright/test';
import {mockApp,prepare,preview} from './fixtures.mjs';
for(const width of [1440,390])test(`nickname correction stays in preview until final import ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mockApp(page);state.signedIn=true;await prepare(page);
 await page.locator('.identity-launcher').first().click();const dialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
 await dialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();await dialog.getByRole('button',{name:/^冷月/}).click();await dialog.getByRole('button',{name:'更正昵称',exact:true}).click();
 await dialog.getByLabel('正确昵称',{exact:true}).fill('');await expect(dialog.getByRole('button',{name:'确认',exact:true})).toBeDisabled();
 await dialog.getByLabel('正确昵称',{exact:true}).fill('冷泠月');await page.screenshot({path:`.test-artifacts/nickname-${width}.png`});
 expect(state.submissions).toHaveLength(0);await dialog.getByRole('button',{name:'确认',exact:true}).click();await preview(page);await expect(page.locator('.nickname-review')).toContainText('冷月 → 冷泠月');expect(state.submissions).toHaveLength(0);
 await page.getByRole('checkbox',{name:/我已核对名单/}).check();await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');
 expect(state.submissions[0].members[0]).toMatchObject({name:'冷泠月',correct_name:'冷泠月',expected_name:'冷月',identity_confirmed:true,source_name:'冷丶月'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
