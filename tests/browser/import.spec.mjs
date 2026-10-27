import { test, expect } from '@playwright/test';
import { mockApp, login, prepare, preview, open, source, id } from './fixtures.mjs';

test('JSON upload, explicit identity, corrections, null/zero and final confirmation',async({page})=>{
  const state=await mockApp(page); await login(page); await prepare(page,true);
  await expect(page.getByRole('button',{name:'下一步 →',exact:true})).toBeDisabled();
  await page.locator('.identity-launcher').first().click();
  const dialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
  await dialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();
  await dialog.getByRole('button',{name:/^冷月/}).click();
  await dialog.getByText('修改识别数据',{exact:true}).click();
  await dialog.getByLabel('昵称',{exact:true}).fill('冷月');
  await dialog.getByLabel('等级',{exact:true}).fill('');
  await dialog.getByRole('button',{name:'确认',exact:true}).click();
  await preview(page);
  await expect(page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true})).not.toBeChecked();
  await expect(page.getByRole('button',{name:'确认导入',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:/我已核对名单/}).check();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('第 3 版');
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0]).toMatchObject({raw_text:source,snapshot_date:'2026-10-27',mode:'merge',is_complete_roster:false,expected_snapshot_id:id,members:[{name:'冷月',level:null,weekly_activity:0,player_id:id}]});
});
test('failed submission retries the same request without duplicating its identity',async({page})=>{
  const state=await mockApp(page); state.failNext=true;
  await login(page); await prepare(page); await preview(page);
  await page.getByRole('checkbox',{name:/我已核对名单/}).check();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('重试');
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('第 3 版');
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[0].request_id).toBe(state.submissions[1].request_id);
});
test('invalid JSON and stale previews cannot silently publish a new version',async({page})=>{
  const state=await mockApp(page); state.conflict=true;
  await login(page); await open(page,'/import');
  await page.getByLabel('截图日期',{exact:true}).fill('2026-10-27');
  await page.getByLabel('JSON 内容',{exact:true}).fill('not JSON');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('JSON 语法错误');
  expect(state.submissions).toHaveLength(0);
  await prepare(page); await preview(page);
  await page.getByRole('checkbox',{name:/我已核对名单/}).check();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('同日数据已变化');
  await expect(page.getByRole('status',{includeHidden:true})).not.toContainText('已保存');
});
