import {test,expect} from '@playwright/test';

for(const width of [1440,390])test(`departed section shares date selection with independent table controls without moving unconfirmed members ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const current={id:'current',snapshot_date:'2026-10-30',revision:2,is_current:true,is_complete_roster:true};
 const old={...current,id:'old',revision:1,is_current:false};
 await page.route('**/api/account',r=>r.fulfill({json:{email:'test@example.invalid',role:'owner'}}));
 await page.route('**/api/club-settings',r=>r.fulfill({json:{name:'测试俱乐部'}}));
 await page.route('**/api/members*',r=>{
  const params=new URL(r.request().url()).searchParams;
  const rejoined=params.get('date')==='2026-10-29',prior=params.get('version')==='old';
  return r.fulfill({json:{snapshots:[current,old,{...current,id:'yesterday',snapshot_date:'2026-10-29'}],snapshot:prior?old:{...current,snapshot_date:rejoined?'2026-10-29':current.snapshot_date},next:null,members:[
   {player_id:'present',name:'在会玩家',presence:'present',pathway:'观众',level:70},
   {player_id:'uncertain',name:'未确认玩家',presence:'unconfirmed',pathway:'占卜家',data_date:'2026-10-27'},
   {player_id:'left',name:'离会玩家',presence:rejoined?'present':'left',pathway:'歌颂者',level:prior?60:69,data_date:prior?'2026-10-25':'2026-10-28'},
  ]}});
 });
 await page.goto('/members');
 const trigger=page.getByRole('button',{name:/暂时离会成员/});
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await expect(trigger).toContainText('1 人');
 await expect(page.getByRole('link',{name:'离会玩家',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'未确认玩家',exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'本次未识别',exact:true})).toBeVisible();
 await page.setViewportSize({width,height:700});
 await page.evaluate(()=>{
  const scroll=window.scrollBy.bind(window);
  window.scrolledDuringExpansion=false;
  window.scrollBy=(...args)=>{
   const panel=document.querySelector('[data-slot="collapsible-content"]');
   if(panel&&panel.getBoundingClientRect().height<panel.scrollHeight-1)window.scrolledDuringExpansion=true;
   scroll(...args);
  };
 });
 await trigger.focus();await page.keyboard.press('Enter');
 await expect(trigger).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('[data-slot="collapsible-content"] > div')).toHaveCSS('opacity','1');
 await expect.poll(()=>page.locator('[data-slot="collapsible-content"]').evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(700);
 expect(await page.evaluate(()=>window.scrolledDuringExpansion)).toBe(true);
 const row=page.getByRole('row').filter({has:page.getByRole('link',{name:'离会玩家',exact:true})});
 await expect(row.getByRole('cell',{name:'2026-10-28',exact:true})).toBeVisible();
 await expect(row.locator('img')).toHaveAttribute('src','/pathway/sun.webp');
 await expect(row.getByRole('link')).toHaveAttribute('href','/players?id=left&date=2026-10-30');
 await page.getByLabel('查看日期').selectOption('2026-10-30');
 await page.getByLabel('保存版本').selectOption('old');
 await expect(page.getByText('旧版本 · 第 1 版')).toBeVisible();
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await trigger.click();
 await expect(row.getByRole('cell',{name:'2026-10-25',exact:true})).toBeVisible();
 await expect(row.getByRole('cell',{name:'60',exact:true})).toBeVisible();
 await page.getByLabel('途径',{exact:true}).selectOption('观众');
 await expect(trigger).toContainText('1 人');
 await expect(row).toBeVisible();
 await expect(page.getByLabel('离会成员途径',{exact:true})).toHaveValue('');
 await page.getByLabel('离会成员途径',{exact:true}).selectOption('歌颂者');
 await expect(page.getByLabel('途径',{exact:true})).toHaveValue('观众');
 await expect(page.getByRole('link',{name:'在会玩家',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'未确认玩家',exact:true})).toHaveCount(0);
 const mainTable=page.getByRole('table').first(),leftTable=page.getByRole('table').nth(1);
 await leftTable.getByRole('button',{name:'等级',exact:true}).click();
 await expect(leftTable.getByRole('columnheader',{name:'等级',exact:true})).toHaveAttribute('aria-sort','ascending');
 await expect(mainTable.getByRole('columnheader',{name:'昵称',exact:true})).toHaveAttribute('aria-sort','ascending');
 await mainTable.getByRole('button',{name:'等级',exact:true}).click();
 await mainTable.getByRole('button',{name:'等级',exact:true}).click();
 await expect(mainTable.getByRole('columnheader',{name:'等级',exact:true})).toHaveAttribute('aria-sort','descending');
 await expect(leftTable.getByRole('columnheader',{name:'等级',exact:true})).toHaveAttribute('aria-sort','ascending');
 await page.getByLabel('搜索玩家').fill('未确认');
 await expect(trigger).toContainText('0 人 / 共 1 人');
 await page.getByLabel('搜索玩家').fill('');
 await page.getByLabel('离会成员途径',{exact:true}).selectOption('');
 await page.getByLabel('途径',{exact:true}).selectOption('');
 await expect(page.locator('[data-slot="collapsible-content"] > div')).toHaveCSS('opacity','1');
 await page.screenshot({path:`.test-artifacts/members-departed-${width}.png`,fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 await trigger.focus();await page.keyboard.press('Space');
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await page.getByLabel('查看日期').selectOption('2026-10-29');
 await expect(trigger).toContainText('0 人');
 await expect(page.getByRole('link',{name:'离会玩家',exact:true})).toBeVisible();
 await trigger.click();
 await expect(page.getByText('当前记录暂无暂时离会成员。')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
