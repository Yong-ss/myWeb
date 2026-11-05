import { test, expect } from '@playwright/test';
import { mockAccount, mockApp, login } from './fixtures.mjs';

// Why: theme, component look and motion must change from the shared layer alone (tokens.css / themes.css /
// lib/theme.ts / components/ui), while the default theme stays the approved baseline.
const id='00000000-0000-4000-8000-000000000001';
const snapshot={id,snapshot_date:'2026-10-28',revision:1,is_current:true,is_complete_roster:true};
const members={snapshots:[snapshot],snapshot,next:null,members:[{player_id:'synthetic-1',name:'档案成员01',position:'正式会员',level:70,pathway:'观众',extraordinary_score:14000,prosperity:1600,weekly_activity:120,group_name:'第一组',join_days:35}]};
async function openMembers(page) {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/members'?route.fulfill({json:members}):route.fulfill({json:{name:'测试俱乐部',can_edit:true}}));
  await mockAccount(page);
  await page.goto('/members');
  await expect(page.getByRole('cell',{name:'档案成员01',exact:true})).toBeVisible();
}
const menu=page=>page.getByRole('button',{name:'菜单'});
const importLink=page=>page.getByRole('link',{name:'导入数据',exact:true}).last();

test('default theme is the baseline; a remembered theme applies before any script and survives reloads',async({page})=>{
  await openMembers(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
  await expect(menu(page)).toHaveCSS('border-top-left-radius','2px');
  await expect(page.getByRole('heading',{level:1})).toHaveCSS('font-family',/Georgia/);

  await page.evaluate(()=>localStorage.setItem('club-theme','test'));
  // No JavaScript bundle runs: only the inline boot script can apply the theme, so the first paint is already right.
  await page.route('**/_next/static/**/*.js',route=>route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','test');
  await expect(page.locator('html')).toHaveAttribute('data-motion','fade');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(16, 20, 31)');
  await page.unroute('**/_next/static/**/*.js');

  await page.reload();
  await expect(page.getByRole('cell',{name:'档案成员01',exact:true})).toBeVisible();
  await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(16, 20, 31)');
  for(const control of [menu(page),importLink(page),page.getByLabel('搜索玩家')])await expect(control).toHaveCSS('border-top-left-radius','6px');
  await expect(page.getByRole('heading',{level:1})).toHaveCSS('font-family',/Segoe UI/);
  await expect(page.getByRole('heading',{level:1})).toHaveCSS('text-shadow','none');

  // An unknown stored value falls back to the default instead of a half-applied theme.
  await page.evaluate(()=>localStorage.setItem('club-theme','missing'));
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
});

test('one token change reaches Button and ButtonLink alike',async({page})=>{
  await openMembers(page);
  await page.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--club-radius','9px');s.setProperty('--club-motion','400ms');s.setProperty('--club-hover','rgb(1, 2, 3)');});
  for(const control of [menu(page),importLink(page)]){
    await expect(control).toHaveCSS('border-top-left-radius','9px');
    await expect(control).toHaveCSS('transition-duration','0.4s');
  }
  await expect(page.locator('[data-slot="card"], [data-slot="table-container"]').first()).toHaveCSS('border-top-left-radius','9px');
});

// Records every inline style Motion writes on the popover while it opens.
async function popoverFrames(page) {
  await page.evaluate(()=>{window.__frames=[];new MutationObserver(list=>{for(const m of list){const el=m.target.closest?.('[data-slot="popover-content"]')??(m.target.nodeType===1&&m.target.querySelector?.('[data-slot="popover-content"]'));if(el)window.__frames.push(el.getAttribute('style')??'');}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});});
  await page.getByRole('button',{name:'查看截图识别方法'}).click();
  const panel=page.locator('[data-slot="popover-content"]');
  await expect(panel).toHaveCSS('opacity','1');
  const frames=await page.evaluate(()=>window.__frames);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button',{name:'查看截图识别方法'})).toBeFocused();
  return frames;
}

test('the theme motion preset switches overlays from rise to fade without page changes',async({page})=>{
  await mockApp(page);await login(page);
  await page.goto('/import');
  const rise=await popoverFrames(page);
  expect(rise.some(s=>/opacity/.test(s))).toBe(true);
  expect(rise.some(s=>/translateY\(-?\d/.test(s))).toBe(true);

  await page.evaluate(()=>localStorage.setItem('club-theme','test'));
  await page.reload();
  const fade=await popoverFrames(page);
  expect(fade.some(s=>/opacity: 0\.|opacity: 0;/.test(s))).toBe(true);
  expect(fade.some(s=>/translate/.test(s))).toBe(false);
});

test('reduced motion with the fade preset leaves no backdrop, focus trap or click blocker after closing',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('club-theme','test'));
  await openMembers(page);
  await menu(page).click();
  const drawer=page.getByRole('dialog',{name:'俱乐部导航'});
  await expect(drawer.getByRole('button',{name:'关闭菜单'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).not.toHaveCount(0);
  await importLink(page).click();
  await expect(page).toHaveURL(/\/import/);
});
