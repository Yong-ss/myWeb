import {test,expect} from '@playwright/test';
import {mockApp,login,preview,source} from './fixtures.mjs';

test('profile name uses the latest observed pathway even after an absent day',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/api/members')?{
  player:{id:'synthetic',display_name:'错误'},timeline:[
   {date:'2026-10-20',status:'present',member:{name:'错误',pathway:'占卜家'},changes:null},
   {date:'2026-10-21',status:'present',member:{name:'错误',pathway:'歌颂者'},changes:null},
   {date:'2026-10-22',status:'left',member:null,changes:null},
  ],
 }:{name:'测试俱乐部',email:'history@example.invalid',role:'owner'}}));
 await page.goto('/players?id=synthetic&date=2026-10-22');
 const heading=page.getByRole('heading',{name:'错误',exact:true});
 await expect(heading.locator('img')).toHaveAttribute('src','/pathway/sun.webp');
 await expect.poll(()=>heading.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.setViewportSize({width:390,height:844});
 await expect(heading).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('pathway artwork preserves stored names, neutral values and member search on desktop and mobile',async({page})=>{
 const names=['占卜家','学徒','观众','窥秘人','战士','歌颂者','未知途径',null];
 const files=['seer','apprentice','spectator','mystery-pryer','warrior','sun'];
 const snapshot={id:'00000000-0000-4000-8000-000000000001',snapshot_date:'2026-10-30',revision:1,is_current:true,is_complete_roster:true};
 await page.route('**/api/account',r=>r.fulfill({json:{email:'pathways@example.invalid',role:'owner'}}));
 await page.route('**/api/club-settings',r=>r.fulfill({json:{name:'途径视觉核对'}}));
 await page.route('**/api/members*',r=>r.fulfill({json:{snapshot,snapshots:[snapshot],next:null,members:names.map((pathway,i)=>({player_id:`synthetic-${i}`,name:`成员${i}`,pathway,level:70,weekly_activity:0}))}}));
 await page.goto('/members');
 for(let i=0;i<names.length;i++){
  const row=page.getByRole('row').filter({has:page.getByRole('link',{name:`成员${i}`,exact:true})});
  const cell=row.getByRole('cell').nth(3);
  await expect(cell).toHaveText(names[i]??'—');
  if(i<6){
   const icon=cell.locator('img');
   await expect(icon).toHaveAttribute('src',[0,2].includes(i) ? `/pathways/${files[i]}.png` : `/pathway/${files[i]}.webp`);
   await expect(icon).toHaveAttribute('alt','');
   await expect.poll(()=>icon.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
   expect(await icon.evaluate(img=>img.getBoundingClientRect().width)).toBe(20);
  }else await expect(cell.locator('img')).toHaveCount(0);
 }
 await page.screenshot({path:'.test-artifacts/pathways-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('cell',{name:'歌颂者',exact:true})).toBeAttached();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('搜索玩家').fill('成员5');
 await expect(page.getByRole('cell',{name:'歌颂者',exact:true})).toHaveCount(1);
 await expect(page.getByRole('cell',{name:'占卜家',exact:true})).toHaveCount(0);
 await page.screenshot({path:'.test-artifacts/pathways-mobile.png',fullPage:true});
});

test('historical rows retain their own pathway names and missing values',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/api/members')?{
  player:{id:'synthetic',display_name:'历史途径'},timeline:['歌颂者','未知途径',null].map((pathway,i)=>({date:`2026-10-${20+i}`,status:'present',member:{name:'历史途径',pathway},changes:null})),
 }:{name:'测试俱乐部',email:'history@example.invalid',role:'owner'}}));
 await page.goto('/players?id=synthetic');
 const sun=page.getByRole('cell',{name:'歌颂者',exact:true});
 await expect(page.getByRole('heading',{name:'历史途径',exact:true}).locator('img')).toHaveCount(0);
 await expect(sun.locator('img')).toHaveAttribute('src','/pathway/sun.webp');
 await expect(page.getByRole('cell',{name:'未知途径',exact:true}).locator('img')).toHaveCount(0);
 await expect(page.getByRole('row').filter({has:page.getByRole('link',{name:'2026-10-22',exact:true})}).getByRole('cell').nth(6)).toHaveText('—');
});

test('import final preview decorates 歌颂者 while preserving the input value',async({page})=>{
 await mockApp(page);await login(page);
 await page.goto('/import');
 await page.getByLabel('截图日期',{exact:true}).fill('2026-10-27');
 const input=JSON.parse(source);input.members[0].pathway='歌颂者';
 await page.getByLabel('JSON 内容',{exact:true}).fill(JSON.stringify(input));
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page.getByRole('heading',{name:'核对成员',exact:true})).toBeVisible();
 await preview(page);
 await expect(page.getByRole('cell',{name:'歌颂者',exact:true}).locator('img')).toHaveAttribute('src','/pathway/sun.webp');
 await expect(page.getByRole('cell',{name:'太阳',exact:true})).toHaveCount(0);
});
