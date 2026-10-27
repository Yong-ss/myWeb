import { test, expect } from '@playwright/test';
import {mockApp,prepare,preview,source} from './fixtures.mjs';
for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,800]]) {
  test(`import theme, identity dialog and preview ${width}`,async({page},info)=>{
    const state=await mockApp(page);state.signedIn=true;await page.setViewportSize({width,height});
    await page.goto('/import');
    await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
    await expect(page.getByLabel('JSON 内容')).toHaveCSS('background-color','rgb(17, 23, 25)');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('prepare.png'),fullPage:true});
    await prepare(page);await page.locator('.identity-launcher').first().click();
    const dialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
    await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('background-color','rgb(27, 32, 33)');
    await dialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();
    await dialog.getByRole('button',{name:/^冷月/}).click();
    await expect(dialog).toHaveCSS('opacity','1');
    await page.screenshot({path:info.outputPath('identity.png')});
    await dialog.getByRole('button',{name:'确认',exact:true}).click();
    await preview(page);await expect(page.getByRole('button',{name:'确认导入',exact:true})).toBeDisabled();
    await expect(page.getByLabel('完整名单，没有漏人',{exact:true})).not.toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('preview.png'),fullPage:true});
    expect(state.submissions).toHaveLength(0);
  });
}
test('styled select picker supports keyboard and Escape',async({page},info)=>{
  // Use the shared component on the import page, without saving anything.
  const state=await mockApp(page);state.signedIn=true;await page.goto('/import');
  await page.getByLabel('截图日期',{exact:true}).fill('2026-10-27');
  await page.getByLabel('JSON 内容',{exact:true}).fill(source.replace('冷丶月','冷月'));
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.locator('.matched-list > summary').click();
  const row=page.locator('.matched-list .identity-compact').first();
  await row.locator(':scope > summary').click();await row.getByText('改选其他玩家',{exact:true}).click();
  const select=page.getByLabel('第 1 行玩家身份',{exact:true});
  await expect(select).toHaveCSS('appearance','base-select');
  await select.click();await expect(select).toHaveJSProperty('value','00000000-0000-4000-8000-000000000001');
  await expect.poll(()=>select.evaluate(el=>el.matches(':open'))).toBe(true);
  await expect.poll(()=>select.evaluate(el=>getComputedStyle(el,'::picker(select)').opacity)).toBe('1');
  await page.screenshot({path:info.outputPath('dropdown.png')});
  await page.keyboard.press('Escape');await expect.poll(()=>select.evaluate(el=>el.matches(':open'))).toBe(false);
  await select.focus();await page.keyboard.press('Space');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('new');expect(state.submissions).toHaveLength(0);
});
test.describe('touch select',()=>{
  test.use({hasTouch:true,viewport:{width:390,height:844}});
  test('styled picker opens and selects with touch',async({page})=>{
    const state=await mockApp(page);state.signedIn=true;await page.goto('/import');
    await page.getByLabel('截图日期',{exact:true}).fill('2026-10-27');await page.getByLabel('JSON 内容',{exact:true}).fill(source.replace('冷丶月','冷月'));
    await page.getByRole('button',{name:'下一步',exact:true}).tap();await page.locator('.matched-list > summary').tap();
    const row=page.locator('.matched-list .identity-compact').first();await row.locator(':scope > summary').tap();await row.getByText('改选其他玩家',{exact:true}).tap();
    const select=page.getByLabel('第 1 行玩家身份',{exact:true});await select.tap();
    await page.getByRole('option',{name:'新增玩家（确认不是已有玩家）',exact:true}).tap();await expect(select).toHaveValue('new');expect(state.submissions).toHaveLength(0);
  });
});
