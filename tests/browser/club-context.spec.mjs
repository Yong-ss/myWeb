import {test,expect} from '@playwright/test';
import {ownerPermissions} from './fixtures.mjs';
// Stage D: the club lives in each tab's URL. These mocks answer per ?club= exactly as the Worker does, so a page that
// forgot its club, or showed another club's late answer, shows the wrong club's data and fails here.
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2',C='00000000-0000-4000-8000-0000000000c3';
const names={[A]:'甲俱乐部',[B]:'乙俱乐部'};
const clubs=[{id:A,name:names[A],roles:['owner']},{id:B,name:names[B],roles:['admin']}];
const snapshot={id:A,snapshot_date:'2026-10-30',revision:1,is_current:true,is_complete_roster:true};
async function mockClubs(page,{hold,signedIn=true}={}){
 const seen=[],held=[];
 await page.context().route('**/api/**',async route=>{
  const url=new URL(route.request().url()),club=url.searchParams.get('club')??A,allowed=club in names;
  seen.push(`${route.request().method()} ${url.pathname} ${url.searchParams.get('club')}`);
  if(url.pathname==='/api/login'){signedIn=true;return route.fulfill({json:{ok:true}});}
  if(!signedIn)return route.fulfill({status:401,json:{error:'请先登录'}});
  if(url.pathname==='/api/account')return route.fulfill({json:{email:'two@example.invalid',club_id:club,roles:allowed?[club===A?'owner':'admin']:[],permissions:allowed?ownerPermissions:[],super_admin:false,mfa_verified:false,mfa_session:false,platform_permissions:[],clubs}});
  if(!allowed)return route.fulfill({status:403,json:{error:'此账户没有俱乐部访问权限'}});
  if(url.pathname==='/api/club-settings')return route.fulfill({json:route.request().method()==='POST'?{name:route.request().postDataJSON().name}:{name:names[club],can_edit:true}});
  if(url.pathname==='/api/members'){
   const answer={json:{snapshots:[snapshot],snapshot,next:null,members:[{player_id:club,name:`${names[club]}成员`,presence:'present',level:70}]}};
   if(hold?.(club))return held.push(()=>route.fulfill(answer));
   return route.fulfill(answer);
  }
  return route.fulfill({json:{snapshot:null,snapshots:[],members:[],points:[],next:null,events:[]}});
 });
 return {seen,held};
}
const member=(page,club)=>page.getByRole('link',{name:`${names[club]}成员`,exact:true});

test('sign-in opens the last club this browser managed; the switcher changes only this tab',async({page,context})=>{
 await context.addInitScript(club=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('club:last-club',club);sessionStorage.setItem('seeded','1');}},B);
 const {seen}=await mockClubs(page,{signedIn:false});
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill('two@example.invalid');await page.getByLabel('密码',{exact:true}).fill('x');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page).toHaveURL(`/account?club=${B}`);await expect(page.locator('.club-brand-name')).toHaveText(names[B]);
 await expect(page.locator('.club-user-name small')).toHaveText('管理员'); // the role in B, not A's 公会长
 // A second tab works in club A at the same time.
 const other=await context.newPage();await other.goto(`/members?club=${A}`);await expect(member(other,A)).toBeVisible();
 // Switch the first tab from B to A's sibling section and back: the other tab is untouched, even after a reload.
 await page.goto(`/members?club=${B}`);await expect(member(page,B)).toBeVisible();
 await page.getByRole('button',{name:/切换俱乐部/}).click();
 const list=page.getByRole('navigation',{name:'选择俱乐部'});
 await expect(list.locator('[aria-current="true"]')).toContainText(names[B]);
 await list.getByRole('link',{name:new RegExp(names[A])}).click();
 await expect(page).toHaveURL(`/members?club=${A}`);await expect(member(page,A)).toBeVisible();await expect(member(page,B)).toHaveCount(0);
 await other.bringToFront();await other.reload();await expect(other).toHaveURL(`/members?club=${A}`);await expect(member(other,A)).toBeVisible();
 await other.goto(`/members?club=${B}`);await expect(member(other,B)).toBeVisible();
 await page.reload();await expect(member(page,A)).toBeVisible();await expect(page.locator('.club-brand-name')).toHaveText(names[A]);
 // Every club request carried the tab's own club; only sign-in and the account-wide checks named none.
 expect(seen.filter(s=>/\/api\/(members|club-settings)/.test(s)&&!/ (00000000-0000-4000-8000-0000000000(a1|b2))$/.test(s))).toEqual([]);
 
});

test('a late answer from the previous club is never shown after switching',async({page})=>{
 const {held}=await mockClubs(page,{hold:club=>club===B});
 await page.goto(`/members?club=${B}`);await expect.poll(()=>held.length).toBe(1);
 // B's roster is still loading; switch to A and only then let B's answer arrive.
 await page.getByRole('button',{name:/切换俱乐部/}).click();
 await page.getByRole('navigation',{name:'选择俱乐部'}).getByRole('link',{name:new RegExp(names[A])}).click();
 await expect(member(page,A)).toBeVisible();
 held[0]();await page.waitForTimeout(300);
 await expect(member(page,B)).toHaveCount(0);await expect(page.locator('.club-brand-name')).toHaveText(names[A]);
});

test('a URL naming a club the account cannot enter says so and stays on that URL',async({page})=>{
 const {seen}=await mockClubs(page);
 await page.goto(`/members?club=${C}`);
 await expect(page.getByText('无法进入这个俱乐部')).toBeVisible();await expect(page).toHaveURL(`/members?club=${C}`);
 await expect(page.getByRole('link',{name:'我的俱乐部'})).toBeVisible();
 // It never showed or fetched another club in its place.
 await expect(page.getByRole('table')).toHaveCount(0);expect(seen.filter(s=>s.includes('/api/members'))).toEqual([]);
 await page.goto('/members?club=not-a-club');await expect(page.getByText('网址中的俱乐部无效')).toBeVisible();
 await expect(page).toHaveURL('/members?club=not-a-club');
});

test('an old link without a club opens the default club and names it in the URL; writes go to the tab club',async({page})=>{
 const {seen}=await mockClubs(page);
 await page.goto('/members?date=2026-10-30');await expect(page).toHaveURL(`/members?date=2026-10-30&club=${A}`);await expect(member(page,A)).toBeVisible();
 await page.goto(`/settings?club=${B}`);await expect(page.getByLabel('名称',{exact:true})).toHaveValue(names[B]);
 seen.length=0;await page.getByLabel('名称',{exact:true}).fill('乙俱乐部新名');await page.getByRole('button',{name:'保存名称',exact:true}).click();
 await expect(page.getByText('名称已保存。')).toBeVisible();await expect(page.locator('.club-brand-name')).toHaveText('乙俱乐部新名');
 expect(seen.filter(s=>s.startsWith('POST'))).toEqual([`POST /api/club-settings ${B}`]);
 // Links inside the page keep the club.
 await page.goto(`/members?club=${B}`);await expect(member(page,B)).toHaveAttribute('href',new RegExp(`club=${B}`));
});

for(const width of [1440,390])test(`club switcher layout ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await mockClubs(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/members?club=${A}`);await expect(member(page,A)).toBeVisible();const trigger=page.getByRole('button',{name:/切换俱乐部/});await expect(trigger).toBeVisible();
 const box=await trigger.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0); // never pushed off-screen
 await trigger.click();const panel=page.getByRole('navigation',{name:'选择俱乐部'});await expect(panel).toBeVisible();
 await page.keyboard.press('Tab');await expect(panel.getByRole('link').first()).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`switcher-${width}.png`)});
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();expect(errors).toEqual([]);
});
