import { test, expect } from '@playwright/test';

const id='00000000-0000-4000-8000-000000000001';
const data={snapshots:[{id,snapshot_date:'2026-10-28',revision:1,is_current:true,is_complete_roster:true}],snapshot:{id,snapshot_date:'2026-10-28',revision:1,is_current:true,is_complete_roster:true},next:'2026-10-01',members:Array.from({length:12},(_,i)=>({player_id:`synthetic-${i}`,name:`档案成员${String(i+1).padStart(2,'0')}`,position:'正式会员',level:70+i,pathway:'观众',extraordinary_score:14000+i*97,prosperity:1600+i*10,weekly_activity:i===0?0:120,group_name:'第一组',join_days:35+i}))};
async function mock(page,handler) {
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/members'?handler(route):route.fulfill({json:{name:'测试俱乐部',can_edit:true}}));
  await page.route('**/*.supabase.co/**',route=>route.abort());
}
for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,800]]) {
  test(`members pilot keyboard, layout and navigation ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height});
    await mock(page,route=>route.fulfill({json:data}));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/members');
    await expect(page.getByRole('cell',{name:'档案成员01',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
    const input=page.getByLabel('搜索玩家'); await input.focus();
    await expect(input).toBeFocused(); await expect(input).toHaveCSS('outline-style','solid');
    await page.keyboard.type('成员01'); await expect(page.getByRole('row')).toHaveCount(2);
    await input.fill('');
    if(width<1024) {
      const menu=page.getByRole('button',{name:'菜单'}); await menu.click();
      const dialog=page.getByRole('dialog',{name:'俱乐部导航'}); await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button',{name:'关闭菜单'})).toBeFocused();
      await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('link',{name:'⚙ 设置'})).toBeFocused();
      await expect(dialog).toHaveCSS('opacity','1');
      await page.screenshot({path:info.outputPath('navigation.png')});
      await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(menu).toBeFocused();
    } else {
      const button=page.getByRole('link',{name:'导入数据',exact:true}).last();
      await button.hover(); await expect(button).toHaveCSS('background-color','rgb(41, 43, 37)');
      await page.mouse.down(); await expect(button).toHaveCSS('background-color','rgb(53, 49, 38)');
      await page.mouse.move(1,1);await page.mouse.up();
    }
    const table=page.locator('.members-table-wrap');
    await table.evaluate(el=>el.scrollLeft=el.scrollWidth);
    if(width<768) expect(await table.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await table.evaluate(el=>el.scrollLeft=0);
    await page.screenshot({path:info.outputPath('members.png'),fullPage:true});
    expect(errors).toEqual([]);
  });
}
test('loading, disabled, retry and reduced motion remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  let pending; let initial; let first=true; let fail=false;
  await mock(page,async route=>{
    if(first) { first=false; await new Promise(resolve=>initial=resolve); }
    if(new URL(route.request().url()).searchParams.has('before')) {
      await new Promise(resolve=>pending=resolve);
      return route.fulfill({status:503,json:{error:'暂时无法读取记录，请重试'}});
    }
    return fail?route.fulfill({status:503,json:{error:'暂时无法读取记录，请重试'}}):route.fulfill({json:data});
  });
  await page.goto('/members');
  await expect(page.getByRole('status')).toContainText('正在读取名单');
  await expect.poll(()=>typeof initial).toBe('function'); initial();
  const older=page.getByRole('button',{name:'更早日期'}); await older.click();
  await expect(page.getByRole('button',{name:'读取中…'})).toBeDisabled();
  await expect.poll(()=>typeof pending).toBe('function');pending();fail=true;
  await expect(page.locator('.club-app').getByRole('alert')).toContainText('暂时无法读取记录');
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.locator('.club-app').getByRole('alert')).toContainText('暂时无法读取记录');
  fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByRole('cell',{name:'档案成员01',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'菜单'}).click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name','none');
  await expect(page.getByRole('button',{name:'关闭菜单'})).toHaveCSS('transition-duration','0s');
});
test.describe('touch navigation',()=>{
  test.use({hasTouch:true,viewport:{width:390,height:844}});
  test('menu can be opened and closed repeatedly by touch',async({page})=>{
    await mock(page,route=>route.fulfill({json:data})); await page.goto('/members');
    const menu=page.getByRole('button',{name:'菜单'});
    for(let i=0;i<2;i++) {
      await menu.tap(); await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button',{name:'关闭菜单'}).tap(); await expect(page.getByRole('dialog')).not.toBeVisible();
    }
    await expect(menu).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  });
});
test('home and member pages share the approved theme',async({page})=>{
  await mock(page,route=>route.fulfill({json:data}));
  await page.goto('/members'); await expect(page.locator('.club-app')).toBeVisible();
  await page.goto('/'); await expect(page.locator('.club-app')).toBeVisible();
  await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
  await expect(page.getByRole('link',{name:'进入俱乐部'})).toBeVisible();
});
