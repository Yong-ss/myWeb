import {test,expect} from '@playwright/test';
import {ownerAccount} from './fixtures.mjs';

const members=['占卜家','占卜家','观众','歌颂者','未知途径很长的原始名称',null].map((pathway,i)=>({player_id:`p${i}`,name:`成员${i}`,pathway,presence:'present',extraordinary_score:10,prosperity:0}));
members.push({player_id:'left',name:'离会占卜家',pathway:'占卜家',presence:'left'},{player_id:'uncertain',name:'待确认占卜家',pathway:'占卜家',presence:'unconfirmed'});
async function mock(page,state){
 await page.route('**/api/**',route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/account')return route.fulfill({json:ownerAccount('chart@example.invalid')});
  if(u.pathname==='/api/club-settings')return route.fulfill({json:{name:'途径测试俱乐部'}});
  state.requests++;
  return state.fail?route.fulfill({status:503,json:{error:'模拟读取失败'}}):route.fulfill({json:{snapshot:state.empty?null:{id:'latest',snapshot_date:'2026-10-30',revision:2,is_current:true,is_complete_roster:true},snapshots:[],members:state.members,next:null}});
 });
}
for(const width of [1440,320])test(`donut counts, focus, navigation and neutral categories ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const state={members,requests:0};await mock(page,state);
 await page.goto('/analytics?view=pathways');
 const card=page.getByRole('region',{name:'途径分布'}),chart=card.getByRole('group',{name:'途径分布图，共 6 位在会成员'});
 await expect(chart).toBeVisible();expect(state.requests).toBe(1);
 const legend=card.getByRole('list',{name:'途径分布明细'});
 await expect(legend.getByRole('link').first()).toContainText('占卜家');
 await expect(legend.getByRole('link').first()).toContainText('33.3%');
 const segment=chart.getByRole('link',{name:/^占卜家/});
 await segment.focus();
 await expect(legend.getByRole('link').first()).toHaveAttribute('data-active','true');
 await expect(card.locator('strong')).toHaveText('2');
 await page.getByRole('heading',{name:'途径分布',exact:true}).click();
 await expect(card.locator('strong')).toHaveText('6');
 await legend.getByRole('link').first().hover();
 await expect(card.locator('strong')).toHaveText('2');
 await page.mouse.move(0,0);
 await expect(card.locator('strong')).toHaveText('6');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`.test-artifacts/pathway-donut-${width}.png`,fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 await segment.focus();await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/pathway=/);
 await expect(page.getByLabel('途径',{exact:true})).toHaveValue('占卜家');
 await expect(page.getByRole('table').first().getByRole('link',{name:/^成员/})).toHaveCount(2);
 await expect(page.getByRole('link',{name:'待确认占卜家',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/不在会成员/})).toHaveAttribute('aria-expanded','false');
 await page.goto('/members?presence=present&pathway_missing=1');
 await expect(page.getByRole('link',{name:'成员5',exact:true})).toBeVisible();
 await expect(page.getByRole('table').first().getByRole('link',{name:/^成员/})).toHaveCount(1);
});

test('empty, failed and refreshed data do not leave stale donut segments',async({page})=>{
 const state={members:[],requests:0,empty:true};await mock(page,state);
 await page.goto('/analytics?view=pathways');await expect(page.getByText('还没有每日记录')).toBeVisible();
 state.empty=false;await page.reload();
 await expect(page.getByText('暂无明确在会成员，暂不生成途径分布。')).toBeVisible();
 state.members=[members[0]];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const chart=page.getByRole('group',{name:'途径分布图，共 1 位在会成员'});
 await expect(chart).toBeVisible();await expect(chart.getByRole('link')).toHaveCount(1);
 state.members=[members[2]];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(chart.getByRole('link',{name:/^观众/})).toBeVisible();
 await expect(chart.getByRole('link',{name:/^占卜家/})).toHaveCount(0);
 state.fail=true;await page.reload();
 await expect(page.getByText('模拟读取失败',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'途径分布'})).toHaveCount(0);
});
