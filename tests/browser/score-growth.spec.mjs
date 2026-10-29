import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`score growth defaults, filters and dates ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});let reads=0;
 await page.route('**/api/**',r=>{
  const u=new URL(r.request().url());
  if(u.pathname==='/api/account')return r.fulfill({json:{email:'growth@example.invalid',role:'owner'}});
  if(u.pathname==='/api/club-settings')return r.fulfill({json:{name:'成长测试俱乐部'}});
  reads++;const date=u.searchParams.get('date')??'2026-10-30',old=date!=='2026-10-30';
  const snapshot={id:date,snapshot_date:date,revision:2,is_current:true,is_complete_roster:true};
  return r.fulfill({json:{snapshot,snapshots:['2026-10-30','2026-10-29','2026-10-28'].map(snapshot_date=>({...snapshot,snapshot_date})),next:null,members:[
   {player_id:'a',name:old?'旧名':'新名',pathway:'歌颂者',presence:'present',data_date:date,extraordinary_score:old?100:120},
   {player_id:'b',name:'下降玩家',pathway:'观众',presence:'present',data_date:date,extraordinary_score:old?50:40},
   {player_id:old?'gone':'new',name:'名单构成玩家',presence:'present',data_date:date,extraordinary_score:old?30:60},
  ]}});
 });
 await page.goto('/analytics?view=growth');const card=page.getByRole('region',{name:'非凡评分成长分析'});
 await expect(card.getByRole('link',{name:'新名',exact:true})).toBeVisible();expect(reads).toBe(2);
 await card.getByRole('button',{name:'这些数字怎么算的？',exact:true}).click();
 await expect(card).toContainText('总变化 +40 = 共同成员成长 +10 + 只在结束日期出现 60 − 只在开始日期出现 30');
 await expect(card.getByRole('figure',{name:'评分变化构成图'})).toContainText('俱乐部总评分变化');
 await expect(card.getByRole('link',{name:'新名',exact:true})).toHaveAttribute('href','/players?id=a&date=2026-10-30');
 await card.getByRole('button',{name:'查看全部',exact:true}).click();
 await card.getByLabel('成长榜筛选').selectOption('down');
 await expect(card.getByRole('link',{name:'下降玩家',exact:true})).toBeVisible();
 await expect(card.getByRole('link',{name:'新名',exact:true})).toHaveCount(0);
 await card.getByLabel('成长榜筛选').selectOption('all');
 await card.getByRole('button',{name:/更改日期/}).click();
 await card.getByLabel('比较起始日期').selectOption('2026-10-30');
 await expect(card.getByText('起始日期必须早于结束日期。')).toBeVisible();
 await expect(card.getByRole('table')).toHaveCount(0);
 await card.getByLabel('比较起始日期').selectOption('2026-10-28');
 await expect(card.getByRole('link',{name:'新名',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await card.screenshot({path:`.test-artifacts/score-growth-${width}.png`});
});
test('dates from the overview link open the same comparison',async({page})=>{
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(!u.pathname.includes('/api/members'))return r.fulfill({json:{name:'测试',role:'owner'}});
  const date=u.searchParams.get('date')??'2026-10-30';return r.fulfill({json:{snapshot:{snapshot_date:date,is_complete_roster:true},snapshots:['2026-10-30','2026-10-29','2026-10-28'].map(snapshot_date=>({snapshot_date})),next:null,members:[{player_id:'a',name:'甲',presence:'present',extraordinary_score:date==='2026-10-28'?50:100}]}});});
 await page.goto('/analytics?view=growth&from=2026-10-28&to=2026-10-30');
 await expect(page.getByRole('region',{name:'非凡评分成长分析'}).locator('strong').filter({hasText:'+50'})).toBeVisible();
});
