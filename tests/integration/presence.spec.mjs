import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,clubId,foreignClubId,foreignPlayerId,baseURL,users,password} from './local.mjs';
test('real REST presence, rejoining and player history stay inside the configured club',async({page,context,request})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
  const access=(await auth('owner')).access_token;
  const member=(name,id=null)=>({player_id:id,name,position:null,level:1,pathway:null,extraordinary_score:0,prosperity:null,weekly_activity:0,group:null,join_days:1,identity_confirmed:true});
  async function commit(date,complete,rows){const response=await rest('rpc/club_commit_import',access,{p_club_id:clubId,p_date:date,p_complete:complete,p_mode:'replace',p_rows:rows,p_raw:JSON.stringify({members:rows}),p_request_id:randomUUID(),p_expected:null,p_confirmed:true});expect(response.ok,await response.text()).toBe(true);}
  await commit('2030-10-01',true,[member('C阶段测试甲'),member('C阶段测试乙')]);
  const players=await (await rest('club_players?display_name=like.C阶段测试*&select=id,display_name',access)).json();
  const a=players.find(p=>p.display_name==='C阶段测试甲').id,b=players.find(p=>p.display_name==='C阶段测试乙').id;
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);await page.goto('/account'); // the Super Admin lands on the platform centre
  async function status(date){const response=await context.request.get(`${baseURL}/api/members?date=${date}&club_id=${foreignClubId}`);expect(response.status(),await response.text()).toBe(200);return (await response.json()).members.find(p=>p.player_id===a);}
  await commit('2030-10-02',false,[member('C阶段测试乙',b)]);expect((await status('2030-10-02')).presence).toBe('unconfirmed');
  await commit('2030-10-03',true,[member('C阶段测试乙',b)]);expect((await status('2030-10-03')).presence).toBe('left');
  await commit('2030-10-04',false,[member('C阶段测试甲',a),member('C阶段测试乙',b)]);expect((await status('2030-10-04')).presence).toBe('present');
  const history=await context.request.get(`${baseURL}/api/members?player=${a}&date=2030-10-04`);expect(history.status(),await history.text()).toBe(200);expect((await history.json()).timeline.filter(r=>r.event).map(r=>r.event)).toEqual(['first_seen','left','rejoined']);
  expect((await context.request.get(`${baseURL}/api/members?player=${foreignPlayerId}`)).status()).toBe(404);
  for(const role of ['admin','outsider','foreign']) {const token=(await auth(role)).access_token;const r=await request.get(`${baseURL}/api/members?player=${a}`,{headers:{Cookie:`__Host-club_access=${token}`}});expect(r.status()).toBe(role==='admin'?200:403);}
  const outsider=(await auth('outsider')).access_token;const denied=await rest(`club_players?club_id=eq.${clubId}`,outsider);expect(await denied.json()).toEqual([]);
  await page.goto(`/players?id=${a}&date=2030-10-04`);await expect(page.getByRole('heading',{name:'C阶段测试甲',exact:true})).toBeVisible();await expect(page.locator('.club-events')).toContainText('重新加入');
});
