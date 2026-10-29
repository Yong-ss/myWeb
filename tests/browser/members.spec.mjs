import { test, expect } from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.route('**/api/account',r=>r.fulfill({json:{email:'members@example.invalid',role:'owner'}}));
 await page.route('**/api/club-settings',r=>r.fulfill({json:{name:'测试俱乐部'}}));
});
const id='00000000-0000-4000-8000-000000000001', old='00000000-0000-4000-8000-000000000002';
test('members support dates, old versions, search and zero values',async({page})=>{
  await page.route('**/api/members*',route=>{
    const query=new URL(route.request().url()).searchParams, historic=query.get('version')===old;
    const snapshots=[{id,snapshot_date:'2026-10-27',revision:2,is_current:true,is_complete_roster:true},{id:old,snapshot_date:'2026-10-27',revision:1,is_current:false,is_complete_roster:false}];
    return route.fulfill({json:{snapshots:query.has('date')?snapshots:[snapshots[0]],snapshot:snapshots[historic?1:0],members:[{player_id:id,name:historic?'旧昵称':'冷月',level:null,weekly_activity:0,pathway:null,extraordinary_score:12,prosperity:null,position:null,group_name:null,join_days:null}],next:null}});
  });
  await page.goto('/members');
  await expect(page.getByRole('cell',{name:'冷月',exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'0',exact:true})).toBeVisible();
  await page.getByLabel('搜索玩家').fill('没有这个人');
  await expect(page.getByRole('cell',{name:'没有符合条件的玩家，请调整搜索或筛选。',exact:true})).toBeVisible();
  await page.getByLabel('搜索玩家').fill('');
  await page.getByLabel('查看日期').selectOption('2026-10-27');
  await page.getByLabel('保存版本').selectOption(old);
  await expect(page.getByRole('cell',{name:'旧昵称',exact:true})).toBeVisible();
  await expect(page.getByText('旧版本 · 第 1 版')).toBeVisible();
});

for(const width of [1440,390])test('member headers sort and combine filters at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 const roles=['会长','外交官','理事','俱乐部之星','一组组长','二组组员','正式成员','候补成员'];
 await page.route('**/api/members*',route=>route.fulfill({json:{
  snapshots:[],snapshot:{id,snapshot_date:'2026-10-28',is_current:true,is_complete_roster:true},
  members:roles.map((position,i)=>({player_id:'player-'+i,name:'玩家'+i,position,level:70,extraordinary_score:100-i,prosperity:i,weekly_activity:0,join_days:i,pathway:i%2?'观众':'战士',group_name:i%2?'一组':'二组',presence:'present'})),next:null
 }}));
 await page.goto('/members');
 const names=()=>page.locator('tbody tr td:nth-child(2)').allTextContents();
 await expect(page.getByRole('button',{name:'职位'})).toBeVisible();
 const headerBoxes=await page.locator('thead :is(.club-table-sort,.club-table-filter)').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {center:r.y+r.height/2,height:r.height};}));
 expect(Math.max(...headerBoxes.map(b=>b.center))-Math.min(...headerBoxes.map(b=>b.center))).toBeLessThan(1);
 expect(new Set(headerBoxes.map(b=>b.height)).size).toBe(1);
 const control=page.getByRole('button',{name:'职位'});
 await control.hover();
 await expect(control).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(control).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
 await page.keyboard.press('Tab');await control.focus();
 await expect(control).toHaveCSS('outline-style','solid');
 const icon=await control.locator('svg').elementHandle();
 await control.click();
 expect(await icon.evaluate(el=>el===document.querySelector('th[aria-sort="ascending"] svg'))).toBe(true);
 await expect(control.locator('.club-sort-direction')).toHaveCSS('opacity','1');
 expect(await names()).toEqual(roles.map((_,i)=>'玩家'+i));
 await expect(page.getByRole('columnheader',{name:'职位'})).toHaveAttribute('aria-sort','ascending');
 await page.getByRole('button',{name:'职位'}).click();
 expect(await names()).toEqual(roles.map((_,i)=>'玩家'+i).reverse());
 await page.getByRole('button',{name:'风尚度'}).click();
 expect((await names())[0]).toBe('玩家0');
 await page.getByRole('button',{name:'风尚度'}).click();
 expect((await names())[0]).toBe('玩家7');
 await expect(page.getByRole('button',{name:'风尚度'}).locator('.club-sort-direction')).toHaveCSS('transform','matrix(-1, 0, 0, -1, 0, 0)');
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(control.locator('.club-sort-direction')).toHaveCSS('transition-duration','0s');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByLabel('途径',{exact:true}).selectOption('观众');
 await expect(page.locator('tbody tr')).toHaveCount(4);
 await page.getByLabel('分组',{exact:true}).selectOption('二组');
 await expect(page.getByText('没有符合条件的玩家，请调整搜索或筛选。')).toBeVisible();
 await page.getByLabel('分组',{exact:true}).selectOption('');
 await page.getByLabel('搜索玩家').fill('玩家3');
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('搜索玩家').fill('');
 await page.getByLabel('途径',{exact:true}).selectOption('');
 await expect(page.locator('tbody tr')).toHaveCount(8);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.members-table-wrap').evaluate(el=>el.scrollLeft=0);
 await page.getByRole('heading',{name:'成员名单',exact:true}).click();
 await page.screenshot({path:'.test-artifacts/member-headers-'+width+'.png',fullPage:true});
});
