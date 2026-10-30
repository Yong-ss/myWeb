import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`header does not remount or move settings during slow verification ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});let hold=true,gate;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/account'&&hold){gate=route;return;}
  return route.fulfill({json:path==='/api/account'?{email:'stable@example.invalid',role:'owner'}:path==='/api/club-settings'?{name:'测试俱乐部',can_edit:true}:{snapshot:null,snapshots:[],members:[],points:[],next:null}});
 });
 await page.goto('/account');const settings=page.locator('.club-header-settings');
 const before=await settings.boundingBox();await expect.poll(()=>Boolean(gate)).toBe(true);
 await gate.fulfill({json:{email:'stable@example.invalid',role:'owner'}});await expect(page.locator('.club-header-account')).toContainText('stable@example.invalid');
 expect(await settings.boundingBox()).toEqual(before);
 await page.locator('.club-top').evaluate(el=>el.dataset.persistTest='same-header');
 gate=null;await settings.click();await expect(page).toHaveURL(/\/settings$/);
 await expect(page.locator('.club-top')).toHaveAttribute('data-persist-test','same-header');
 await expect(page.locator('.club-header-account')).toContainText('stable@example.invalid');expect(await settings.boundingBox()).toEqual(before);
 await expect.poll(()=>Boolean(gate)).toBe(true);hold=false;await gate.fulfill({json:{email:'stable@example.invalid',role:'owner'}});
});
for(const width of [1440,390])test(`private pages share a sticky account and settings header ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.route('**/api/**',route=>{
  const u=new URL(route.request().url());
  return route.fulfill({json:u.pathname==='/api/account'?{email:'header@example.invalid',role:'owner'}:u.pathname==='/api/club-settings'?{name:'测试俱乐部',can_edit:true}:u.searchParams.has('player')?{player:{id:'00000000-0000-4000-8000-000000000001',display_name:'测试玩家'},timeline:[],next:null}:{snapshot:null,snapshots:[],members:[],points:[],next:null}});
 });
 let height;
 for(const path of ['/account','/members','/players?id=00000000-0000-4000-8000-000000000001','/import','/settings']){
  await page.goto(path);const header=page.locator('.club-top');
  await expect(header).toContainText('header@example.invalid');
  await expect(header.getByRole('link',{name:'设置',exact:true})).toBeVisible();
  await expect(header.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
  await expect(page.locator('.club-top')).toHaveCount(1);
  await expect(page.locator('.club-sidebar')).toHaveCount(1);
  const box=await header.boundingBox();if(height===undefined)height=box.height;else expect(box.height).toBe(height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.addStyleTag({content:'main { min-height: 200vh !important; }'});await page.evaluate(()=>scrollTo(0,500));
  await expect.poll(async()=>Math.round((await header.boundingBox()).y)).toBe(0);
  if(width===1440)await expect.poll(async()=>Math.round((await page.locator('.club-sidebar').boundingBox()).y)).toBe(Math.round(box.height));
 }
});
