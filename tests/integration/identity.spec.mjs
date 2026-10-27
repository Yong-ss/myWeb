import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {baseURL,users,password,rest,auth,clubId,playerId,foreignPlayerId} from './local.mjs';

const row=name=>({name,position:null,level:null,pathway:null,extraordinary_score:null,prosperity:null,weekly_activity:null,group:null,join_days:null});
test.beforeEach(async({context,page})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort('blockedbyclient'));
  await page.goto('/login'); await page.waitForLoadState('networkidle');
  await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page).toHaveURL(/\/account$/);
});
async function prepare(page,date,members) {
  await page.goto('/import');await page.waitForLoadState('networkidle');
  await page.getByLabel('截图日期',{exact:true}).fill(date);
  await page.getByLabel('JSON 内容',{exact:true}).fill(JSON.stringify({schema_version:1,snapshot_date:null,is_complete_roster:false,members}));
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(page.getByRole('heading',{name:'核对成员',exact:true})).toBeVisible();
}
async function save(page,{complete=false}={}) {
  await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true})).not.toBeChecked();
  if(complete)await page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true}).check();
  await page.getByRole('checkbox',{name:/我已核对名单/}).check();
  const request=page.waitForRequest(r=>r.url().endsWith('/api/imports')&&r.method()==='POST');
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  return (await request).postDataJSON();
}
test('79 players bulk-confirm once, then next-day exact matching needs no individual choices',async({page})=>{
  const members=Array.from({length:79},(_,i)=>row(`首批建档${String(i).padStart(3,'0')}号`));
  await prepare(page,'2026-10-10',members);
  await page.getByRole('button',{name:'确认这 79 人是新玩家',exact:true}).click();
  await expect(page.getByText('新增 79 人',{exact:true})).toBeVisible();
  await save(page,{complete:true});
  const access=(await auth('owner')).access_token;
  const players=await (await rest('club_players?display_name=like.首批建档*',access)).json();expect(players).toHaveLength(79);
  await prepare(page,'2026-10-11',members);
  await expect(page.getByText('全部已对上',{exact:true})).toBeVisible();
  expect(await page.getByLabel('第 1 行玩家身份',{exact:true}).isVisible()).toBe(false);
  const payload=await save(page);expect(payload.members.every(m=>m.player_id&&m.identity_confirmed===false)).toBe(true);
  expect(new Set(payload.members.map(m=>m.player_id)).size).toBe(79);
  expect(await (await rest('club_players?display_name=like.首批建档*',access)).json()).toHaveLength(79);
  await prepare(page,'2026-10-12',members.slice(0,71));
  await expect(page.getByText(/比上次少 8 人，请检查是否漏图/)).toBeVisible();
  await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'完整名单，没有漏人',exact:true})).not.toBeChecked();
});
test('similar typo is confirmed and remembered, auto-matches next day, and wrong alias can be revoked',async({page,context})=>{
  const typo='集成测式玩家';
  await prepare(page,'2026-10-13',[row(typo)]);
  await expect(page.getByText(/还有 1 人没对上/)).toBeVisible();
  await page.locator('.identity-launcher').first().click();
  const dialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
  await dialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();
  await dialog.locator('.identity-picker-list button').filter({hasText:'集成测试玩家'}).click();
  await dialog.getByRole('checkbox',{name:/记住这个AI错名/}).check();
  await dialog.getByRole('button',{name:'确认',exact:true}).click();
  await save(page);
  const access=(await auth('owner')).access_token;
  expect((await (await rest(`club_players?id=eq.${playerId}`,access)).json())[0].display_name).toBe('集成测试玩家');
  await prepare(page,'2026-10-14',[row(typo)]);
  await expect(page.getByText('全部已对上',{exact:true})).toBeVisible();
  const payload=await save(page);expect(payload.members[0]).toMatchObject({player_id:playerId,source_name:typo,identity_confirmed:false});
  const snaps=await (await rest(`club_snapshots?snapshot_date=eq.2026-10-14&club_id=eq.${clubId}`,access)).json();
  expect((await (await rest(`club_snapshot_players?snapshot_id=eq.${snaps[0].id}`,access)).json())[0].source_name).toBe(typo);
  await prepare(page,'2026-10-15',[row(typo)]);
  await page.getByText('更多设置',{exact:true}).click();await page.getByText(/已记住的名字/).click();await page.getByRole('button',{name:'解除错误关联',exact:true}).click();await page.getByRole('button',{name:'确认解除此别名',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('别名关联已解除');
  await expect(page.getByText('还有 1 人没对上',{exact:true})).toBeVisible();
  // The actual API enforces same-origin and tenant scope too.
  expect((await context.request.post(baseURL+'/api/player-aliases',{headers:{Origin:'https://wrong.invalid'},data:{player_id:playerId,alias_name:'越权',confirmed:true}})).status()).toBe(403);
  expect((await context.request.post(baseURL+'/api/player-aliases',{headers:{Origin:baseURL},data:{player_id:foreignPlayerId,alias_name:'越权',confirmed:true}})).status()).toBe(403);
});
test('real alias conflicts and same-name people cannot silently merge; explicit rejoining retains UUID',async({page,context})=>{
  const access=(await auth('owner')).access_token;
  const commit=(date,members)=>rest('rpc/club_commit_import',access,{p_club_id:clubId,p_date:date,p_complete:true,p_mode:'replace',p_rows:members,p_raw:'isolated identity fixture',p_request_id:randomUUID(),p_expected:null,p_confirmed:true});
  const first=await commit('2026-10-16',[{...row('同名玩家'),player_id:null,identity_confirmed:true},{...row('同名玩家'),player_id:null,identity_confirmed:true}]);expect(first.status).toBe(200);
  const snapshot=(await first.json()).snapshot_id;
  const people=await (await rest(`club_snapshot_players?snapshot_id=eq.${snapshot}`,access)).json();expect(people).toHaveLength(2);expect(people[0].player_id).not.toBe(people[1].player_id);
  for(const person of people) expect((await rest('rpc/club_manage_alias',access,{p_club_id:clubId,p_player_id:person.player_id,p_alias:'冲突别名'})).status).toBe(200);
  await prepare(page,'2026-10-17',[row('冲突别名')]);await expect(page.getByText('还有 1 人没对上',{exact:true})).toBeVisible();
  await page.locator('.identity-launcher').first().click();const conflictDialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
  await conflictDialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();
  await expect(conflictDialog.locator('.identity-picker-list button').filter({hasText:'同名玩家'})).toHaveCount(2);
  await conflictDialog.getByRole('button',{name:'稍后处理',exact:true}).click();
  const rejected=await commit('2026-10-17',[{...row('冲突别名'),player_id:people[0].player_id,identity_confirmed:false}]);expect(rejected.status).toBe(409);
  // Wrong mapping corrected by revoking only that alias, without touching snapshots.
  const aliases=await (await rest(`club_player_aliases?alias_name=eq.冲突别名&player_id=eq.${people[1].player_id}`,access)).json();
  expect((await context.request.post(baseURL+'/api/player-aliases',{headers:{Origin:baseURL},data:{revoke_id:aliases[0].id,confirmed:true}})).status()).toBe(200);
  expect((await commit('2026-10-18',[{...row('其他人'),player_id:people[1].player_id,identity_confirmed:true}])).status).toBe(200);
  expect((await commit('2026-10-19',[{...row('冲突别名'),player_id:people[0].player_id,identity_confirmed:false}])).status).toBe(200);
  const history=await (await rest(`club_snapshot_players?player_id=eq.${people[0].player_id}`,access)).json();expect(history).toHaveLength(2);
});
