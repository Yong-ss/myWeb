import { test, expect } from '@playwright/test';
import { mockApp, open, login } from './fixtures.mjs';

test('login errors, account reload, logout and unauthorized redirect',async({page})=>{
  await mockApp(page);
  await open(page,'/account'); await expect(page).toHaveURL(/\/login$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('邮箱',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('密码',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('邮箱、密码不正确');
  await login(page);
  await page.reload(); await expect(page.getByText('fixture@example.invalid',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await open(page,'/account'); await expect(page).toHaveURL(/\/login$/);
});
