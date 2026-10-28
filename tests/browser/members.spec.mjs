import { test, expect } from '@playwright/test';
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
  await expect(page.getByRole('heading',{name:'没有找到这个名字',exact:true})).toBeVisible();
  await page.getByLabel('搜索玩家').fill('');
  await page.getByLabel('查看日期').selectOption('2026-10-27');
  await page.getByLabel('保存版本').selectOption(old);
  await expect(page.getByRole('cell',{name:'旧昵称',exact:true})).toBeVisible();
  await expect(page.getByText('旧版本 · 第 1 版')).toBeVisible();
});
