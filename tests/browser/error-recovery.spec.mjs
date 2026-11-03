import {test,expect} from '@playwright/test';
import {ownerAccount} from './fixtures.mjs';

const id='00000000-0000-4000-8000-000000000001';
const snapshot={id,snapshot_date:'2026-10-28',revision:1,is_current:true,is_complete_roster:true};
const good={snapshot,snapshots:[snapshot],members:[{player_id:id,name:'档案成员',extraordinary_score:10,prosperity:null,presence:'present'}],next:null,snapshot_count:1};
// `members` is not a list, so the overview throws while rendering: a real page crash, not a failed request.
const broken={...good,members:'not-a-list'};

test('a page crash keeps navigation usable, hides details, and Retry fetches fresh data',async({page})=>{
 let memberReads=0;
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://127.0.0.1:8791')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  // The scope header makes responses cacheable, so a retry that reused the cache would crash again.
  const headers={'Cache-Control':'no-store','X-Club-Scope':`owner:${id}`};
  if(url.pathname==='/api/account')return route.fulfill({json:ownerAccount('fixture@example.invalid'),headers});
  if(url.pathname==='/api/club-settings')return route.fulfill({json:{name:'测试俱乐部',can_edit:true},headers});
  if(url.pathname==='/api/members'&&url.searchParams.has('trend'))return route.fulfill({json:{points:[],next:null},headers});
  if(url.pathname==='/api/members')return route.fulfill({json:memberReads++===0?broken:good,headers});
  return route.fulfill({status:404,json:{error:'Unknown test endpoint'}});
 });
 await page.goto('/account');
 const main=page.getByRole('main');
 await expect(main.getByRole('heading',{name:'这个页面出错了'})).toBeVisible();
 await expect(main).not.toContainText(/filter|TypeError|not a function|not-a-list/);
 await expect(page.getByRole('navigation',{name:'俱乐部导航'}).first().getByRole('link',{name:'成员名单'})).toBeVisible();
 await expect(page.locator('.club-header-account')).toContainText('fixture@example.invalid');
 await page.evaluate(()=>{window.__sameDocument=true;});
 await main.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.getByRole('heading',{name:'俱乐部总览'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'这个页面出错了'})).toHaveCount(0);
 await expect(page.getByText('明确在会',{exact:true})).toBeVisible();
 // Recovered in place (no full reload), with a new request rather than the cached response that crashed.
 expect(await page.evaluate(()=>window.__sameDocument)).toBe(true);
 expect(memberReads).toBe(2);
});
