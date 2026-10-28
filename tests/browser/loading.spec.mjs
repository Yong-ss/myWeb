import {test,expect} from '@playwright/test';
import {mockApp,source} from './fixtures.mjs';
test('settings read errors offer a working retry without submitting a name',async({page})=>{
 let failed=true,writes=0;
 await page.route('**/api/**',route=>{
  if(route.request().method()!=='GET')writes++;
  return route.fulfill(failed?{status:503,json:{error:'模拟设置读取失败'}}:{json:{name:'恢复后的俱乐部',can_edit:true}});
 });
 await page.goto('/settings');await expect(page.getByRole('button',{name:'重试',exact:true})).toBeVisible();
 failed=false;await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.getByLabel('名称',{exact:true})).toHaveValue('恢复后的俱乐部');
 await expect(page.getByRole('button',{name:'保存名称',exact:true})).toBeEnabled();expect(writes).toBe(0);
});
test('fast import reads never mount the Lottie player',async({page})=>{
 const state=await mockApp(page);state.signedIn=true;let animations=0;
 page.on('request',r=>{if(r.url().includes('/animations/'))animations++;});
 await page.goto('/import');await page.getByLabel('JSON 内容',{exact:true}).fill(source);
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page.getByRole('button',{name:'下一步 →',exact:true})).toBeVisible();
 await expect(page.locator('.club-page-loader')).toHaveCount(0);expect(animations).toBe(0);
});
for(const mode of ['animated','reduced','fallback'])test(`local PageLoader ${mode}, failure and retry`,async({page},info)=>{
 await page.setViewportSize({width:mode==='animated'?1440:390,height:900});
 if(mode==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
 const state=await mockApp(page);state.signedIn=true;
 let held;let animationRequests=0;
 page.on('request',request=>{if(request.url().includes('/animations/'))animationRequests++;});
 if(mode==='fallback')await page.route('**/animations/*.json',r=>r.abort());
 await page.route('**/api/import-context?*',route=>{held=route;});
 await page.goto('/import');await page.getByLabel('JSON 内容',{exact:true}).fill(source);
 const before=await page.locator('fieldset').evaluate(el=>el.getBoundingClientRect().y+scrollY);
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page.getByRole('button',{name:'正在读取…',exact:true})).toBeDisabled();
 await expect(page.locator('.club-import-processing[data-visible=true]')).toBeVisible();
 if(mode==='animated')await expect(page.locator('.club-archive-mark__lottie.is-ready svg')).toBeVisible();
 else await expect(page.locator('.club-archive-mark__fallback')).toBeVisible();
 if(mode==='reduced'){
  expect(animationRequests).toBe(0);
  await expect(page.locator('.club-loading-spinner__ring').first()).toHaveCSS('animation-name','none');
 }
 expect(await page.locator('fieldset').evaluate(el=>el.getBoundingClientRect().y+scrollY)).toBe(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`${mode}.png`),fullPage:true});
 await held.fulfill({status:503,json:{error:'测试连接失败，请重试'}});
 await expect(page.locator('main [role=alert]')).toContainText('测试连接失败');
 await expect(page.getByRole('button',{name:'下一步',exact:true})).toBeEnabled();
 await page.unroute('**/api/import-context?*');
 await page.getByRole('button',{name:'下一步',exact:true}).click();

 await expect(page.locator('.club-import-processing')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'下一步 →',exact:true})).toBeVisible();
});
for(const width of [1440,320])test(`table loading, error, retry and empty ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});let held;
 await page.route('**/api/**',route=>{
  if(new URL(route.request().url()).pathname==='/api/members'){held=route;return;}
  return route.fulfill({json:{name:'测试俱乐部'}});
 });
 await page.goto('/members');await expect(page.getByRole('status',{name:'正在读取名单…'})).toBeVisible();
 await expect(page.getByLabel('搜索玩家')).toBeVisible();
 const controls=await page.getByLabel('搜索玩家').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('table.png'),fullPage:true});
 await held.fulfill({status:503,json:{error:'测试读取失败'}});
 await expect(page.getByRole('button',{name:'重试',exact:true})).toBeVisible();
 held=null;await page.getByRole('button',{name:'重试',exact:true}).click();await expect.poll(()=>Boolean(held)).toBe(true);
 await held.fulfill({json:{snapshot:null,snapshots:[],members:[],next:null}});
 await expect(page.getByRole('heading',{name:'还没有保存记录'})).toBeVisible();
 expect(await page.getByLabel('搜索玩家').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};})).toEqual(controls);
});


