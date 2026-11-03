import {test,expect} from '@playwright/test';
import {ownerAccount} from './fixtures.mjs';
for(const width of [1440,390])test(`saved club name is shared across pages and reloads ${width}`,async({page})=>{
 let name='原俱乐部';
 await page.setViewportSize({width,height:844});await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/club-settings'){
   if(r.request().method()==='POST'){const body=r.request().postDataJSON();expect(body.expected_name).toBe(name);name=body.name;}
   return r.fulfill({json:{name,can_edit:true}});
  }
  return r.fulfill({json:path==='/api/account'?ownerAccount('preview@example.invalid'):{snapshot:null,snapshots:[],members:[],points:[],next:null}});
 });
 await page.goto('/settings');await expect(page.getByLabel('名称',{exact:true})).toHaveValue(name);await page.getByLabel('名称',{exact:true}).fill('白银之手');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page.getByRole('status')).toHaveText('名称已保存。');await expect(page.locator('.club-brand-name')).toHaveText('白银之手');await expect(page.locator('.club-brand-subtitle')).toHaveText('数据检测平台');await page.reload();await expect(page.getByLabel('名称',{exact:true})).toHaveValue('白银之手');await page.goto('/account');await expect(page.locator('.club-brand-name')).toHaveText('白银之手');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
