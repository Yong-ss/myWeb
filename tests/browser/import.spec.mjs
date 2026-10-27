import { test, expect } from '@playwright/test';
import { mockApp, login, prepare, preview, open, source, id } from './fixtures.mjs';

test('JSON upload, explicit identity, corrections, null/zero and final confirmation',async({page})=>{
  const state=await mockApp(page); await login(page); await prepare(page,true);
  await expect(page.getByRole('checkbox',{name:/已提供完整成员名单/})).not.toBeChecked();
  await page.getByLabel('同日处理方式（必须选择）',{exact:true}).selectOption('merge');
  await page.getByRole('button',{name:'生成最终预览',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(/尚未确认玩家身份/);
  await page.getByLabel('第 1 行昵称',{exact:true}).fill('冷月');
  await page.getByLabel('第 1 行等级',{exact:true}).fill('');
  await preview(page);
  await expect(page.getByRole('button',{name:'确认导入',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:/我已逐行核对身份/}).check();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('第 3 版');
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0]).toMatchObject({raw_text:source,snapshot_date:'2026-10-27',mode:'merge',is_complete_roster:false,expected_snapshot_id:id,members:[{name:'冷月',level:null,weekly_activity:0,player_id:id}]});
});
test('failed submission retries the same request without duplicating its identity',async({page})=>{
  const state=await mockApp(page); state.failNext=true;
  await login(page); await prepare(page); await preview(page);
  await page.getByRole('checkbox',{name:/我已逐行核对身份/}).check();
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
  await page.getByLabel('实际截图日期（可补录）',{exact:true}).fill('2026-10-27');
  await page.getByLabel('JSON 原文',{exact:true}).fill('not JSON');
  await page.getByRole('button',{name:'校验并准备预览',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('JSON 语法错误');
  expect(state.submissions).toHaveLength(0);
  await prepare(page); await preview(page);
  await page.getByRole('checkbox',{name:/我已逐行核对身份/}).check();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('同日数据已变化');
  await expect(page.getByRole('status')).not.toContainText('已保存');
});
