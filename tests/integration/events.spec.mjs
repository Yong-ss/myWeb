import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,baseURL,users,password,clubId,foreignClubId,playerId} from './local.mjs';
// Four-Way League on real Supabase Auth + Worker + database (synthetic data only). The owner imports through the real
// page; then the stored result, the read/import/edit separation, alliance read-only access without the raw JSON,
// club isolation, optimistic versions, void/restore and attendance are checked through the Worker and REST.
const out=(name,kills)=>({player_name:name,club_name:'集成俱乐部',kills,assists:3,dispersals:0,awakens:1});
const str=(name,extra={})=>({player_name:name,club_name:'集成俱乐部',player_damage:'50.1万',damage_taken:199000,healing:0,guardian_damage:4527000,purification:0,...extra});
const raw=JSON.stringify({schema_version:1,event_type:'four_way_league',output:[out('集成测试玩家',9),out('联赛新人',0),out('集成测试玩家',9)],strategy:[str('联赛新人',{player_damage:0}),str('集成测试玩家丶')]});
const D='2019-06-01';

test('four-way league: import through the page, read/import/edit separation, alliance read-only, versions, attendance',async({page,request})=>{
 test.setTimeout(150000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const alliance=randomUUID(),snap=randomUUID(),snap2=randomUUID(),imp=randomUUID(),imp2=randomUUID();
 // Member history: the seeded player is in the club on 2019-05-30 and 2019-06-05 (so absent from an event in between).
 sql(`insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values('${imp}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}'),('${imp2}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}');
  insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id) values('${snap}','${clubId}','2019-05-30',1,'${imp}'),('${snap2}','${clubId}','2019-06-05',1,'${imp2}');
  insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name) values('${clubId}','${snap}','${playerId}','集成测试玩家'),('${clubId}','${snap2}','${playerId}','集成测试玩家');
  insert into public.club_alliances(id,name) values('${alliance}','Events alliance');
  insert into public.club_alliance_members(alliance_id,club_id) values('${alliance}','${clubId}');
  insert into public.alliance_leaders(alliance_id,user_id) values('${alliance}','${users.outsider.id}');`);
 try{
  // 1. The owner imports through the real page: duplicate pinned row merged, misspelling confirmed, newcomer created.
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/); // the integration owner is also the Super Admin
  await page.goto(`/events/import?club=${clubId}`);
  await page.getByLabel('比赛日期').fill(D);await page.getByLabel('本俱乐部总积分').fill('3000');await page.getByLabel('AI 输出的 JSON').fill(raw);
  await page.getByRole('button',{name:'开始核对'}).click();
  await expect(page.getByText('已合并 1 条完全相同的重复行')).toBeVisible();
  await page.getByRole('button',{name:'确认身份'}).first().click();
  for(let i=0;i<3;i++){
   const dialog=page.getByRole('dialog');
   if(await dialog.getByText('集成测试玩家丶').isVisible()){await dialog.getByRole('button',{name:'选择已有玩家'}).click();await dialog.getByRole('button',{name:/^集成测试玩家/}).first().click();}
   else await dialog.getByRole('button',{name:'新增玩家'}).click();
   await dialog.getByRole('button',{name:'确认',exact:true}).click();
  }
  await page.getByRole('button',{name:'下一步 →'}).click();await page.getByRole('button',{name:'确认并保存'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认保存'}).click();
  await expect(page).toHaveURL(/\/event\?/);
  await expect(page.getByRole('heading',{name:`四方联赛 · ${D}`})).toBeVisible();
  const owner=(await auth('owner')).access_token,admin=(await auth('admin')).access_token,leader=(await auth('outsider')).access_token,foreign=(await auth('foreign')).access_token;
  const list=await (await get(`events?club=${clubId}`,owner)).json();
  const ev=list.events.find(e=>e.event_date===D);
  expect(ev).toMatchObject({total_score:3000,participants:2,total_kills:9,version:1});
  const detail=await (await get(`event?club=${clubId}&id=${ev.id}`,owner)).json();
  expect(detail.raw_text).toBe(raw);
  const seeded=detail.players.find(p=>p.player_id===playerId);
  expect(seeded).toMatchObject({kills:9,player_damage:501000,output_name:'集成测试玩家',strategy_name:'集成测试玩家丶',origin:'import'});
  const newcomer=detail.players.find(p=>p.display_name==='联赛新人');expect(newcomer.kills).toBe(0);
  // The new player is an identity only: no daily roster row was written for them.
  expect(Number(sql(`select count(*) from public.club_snapshot_players where player_id='${newcomer.player_id}';`))).toBe(0);

  // 2. Same date again is refused; the tables themselves are closed to clients.
  const players=[{player_id:playerId,name:null,output_name:null,strategy_name:null,remember_alias:false,kills:1,assists:0,dispersals:0,awakens:0,player_damage:0,damage_taken:0,healing:0,guardian_damage:0,purification:0}];
  const create=(t,date=D)=>post(`events?club=${clubId}`,t,{event_date:date,total_score:1,players,raw_text:raw,request_id:randomUUID()});
  expect((await create(admin)).status()).toBe(409);
  for(const table of ['club_events','club_event_players','club_event_imports','club_event_versions'])expect((await rest(`${table}?select=*`,owner)).status).not.toBe(200);

  // 3. Read is required for import/edit; import never implies edit. Changes apply on the next request.
  const setAdmin=(permission,value)=>post(`team/personal?club=${clubId}`,owner,{user_id:users.admin.id,permission,value});
  expect((await setAdmin('events.read',false)).status()).toBe(200);
  expect((await get(`events?club=${clubId}`,admin)).status()).toBe(403);
  expect((await create(admin,'2019-06-02')).status()).toBe(403);
  expect((await rest('rpc/club_events_list',admin,{p_club:clubId})).status).toBe(403);
  expect((await setAdmin('events.read',null)).status()).toBe(200);
  expect((await setAdmin('events.edit',false)).status()).toBe(200);
  expect((await post(`event?club=${clubId}`,admin,{event_id:ev.id,expected_version:1,action:'score',payload:{total_score:1},request_id:randomUUID()})).status()).toBe(403);
  expect((await setAdmin('events.edit',null)).status()).toBe(200);

  // 4. Alliance leader: reads list, detail and attendance; never the raw JSON; every write and the name list refused.
  expect((await (await get(`account?club=${clubId}`,leader)).json()).permissions).toContain('events.read');
  const seen=await (await get(`event?club=${clubId}&id=${ev.id}`,leader)).json();
  expect(seen.players).toHaveLength(2);expect(seen.raw_text).toBeNull();
  expect((await get(`player-events?club=${clubId}&player=${playerId}`,leader)).status()).toBe(200);
  expect((await get(`event-identities?club=${clubId}`,leader)).status()).toBe(403);
  expect((await post(`event?club=${clubId}`,leader,{event_id:ev.id,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(403);
  // Another club's owner sees nothing of this club, by Worker or REST.
  expect((await get(`events?club=${clubId}`,foreign)).status()).toBe(403);
  expect((await rest('rpc/club_event_detail',foreign,{p_club:clubId,p_event:ev.id})).status).toBe(403);
  expect((await post(`event?club=${foreignClubId}`,foreign,{event_id:ev.id,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(400); // not found in their own club

  // 5. Versions: a stale edit is refused, a retry with the same request id is saved once.
  const edit=(body)=>post(`event?club=${clubId}`,admin,{event_id:ev.id,request_id:randomUUID(),...body});
  const request1={event_id:ev.id,expected_version:1,action:'score',payload:{total_score:3100},request_id:randomUUID()};
  expect((await post(`event?club=${clubId}`,admin,request1)).status()).toBe(200);
  expect(await (await post(`event?club=${clubId}`,admin,request1)).json()).toMatchObject({version:2,replayed:true});
  expect((await edit({expected_version:1,action:'score',payload:{total_score:3200}})).status()).toBe(409);
  // Rebinding the newcomer onto the seeded player (already in this event) is refused; removing the newcomer works.
  expect((await edit({expected_version:2,action:'rebind',payload:{from_player:newcomer.player_id,to_player:playerId,name:null}})).status()).toBe(409);
  expect((await edit({expected_version:2,action:'remove',payload:{player_id:newcomer.player_id}})).status()).toBe(200);
  expect((await edit({expected_version:3,action:'remove',payload:{player_id:playerId}})).status()).toBe(409); // never an empty event

  // 6. Attendance: attended here; then void -> not counted; the seeded player was in the club before and after.
  let att=await (await get(`player-events?club=${clubId}&player=${playerId}`,owner)).json();
  expect(att.attended.map(a=>a.event_date)).toContain(D);
  expect((await edit({expected_version:3,action:'void',payload:{}})).status()).toBe(200);
  att=await (await get(`player-events?club=${clubId}&player=${playerId}`,owner)).json();
  expect(att.attended.map(a=>a.event_date)).not.toContain(D);
  // A new valid event on a date the player missed, with another participant: an absence, with no invented result row.
  const other=await (await post(`events?club=${clubId}`,owner,{event_date:'2019-06-03',total_score:5,players:[{...players[0],player_id:null,name:'联赛另一人'}],raw_text:raw,request_id:randomUUID()})).json();
  att=await (await get(`player-events?club=${clubId}&player=${playerId}`,owner)).json();
  expect(att.absent.map(a=>a.event_id)).toContain(other.event_id);
  // The freed date can be reused; the voided event cannot then be restored onto it.
  const reused=await create(owner);expect(reused.status()).toBe(200);
  expect((await edit({expected_version:4,action:'restore',payload:{}})).status()).toBe(409);
  // Every change is in the club log.
  expect(Number(sql(`select count(*) from public.club_audit_events where club_id='${clubId}' and action like 'event\\_%' and target_id='${ev.id}';`))).toBe(4);
 }finally{
  // History tables are append-only for clients and triggers; the disposable test database is cleaned by its owner here.
  sql(`set session_replication_role=replica;
   delete from public.club_event_versions where club_id='${clubId}'; delete from public.club_event_imports where club_id='${clubId}';
   delete from public.club_event_players where club_id='${clubId}'; delete from public.club_events where club_id='${clubId}';
   delete from public.club_player_aliases where club_id='${clubId}' and alias_name='集成测试玩家丶';
   delete from public.club_players where club_id='${clubId}' and display_name in ('联赛新人','联赛另一人');
   delete from public.club_audit_events where club_id='${clubId}' and action like 'event\\_%';
   -- The owner's events.* settings for the admin made here, so specs that count those log entries see none of them.
   delete from public.club_audit_events where club_id='${clubId}' and action='admin_permission_changed' and details->>'permission' like 'events.%';
   delete from public.platform_audit_events where action like 'club_permission_overrides.%' and coalesce(details#>>'{new,permission_key}',details#>>'{old,permission_key}') like 'events.%';
   delete from public.club_permission_overrides where club_id='${clubId}' and user_id='${users.admin.id}' and permission_key like 'events.%';
   set session_replication_role=origin;
   delete from public.club_snapshot_players where snapshot_id in ('${snap}','${snap2}'); delete from public.club_snapshots where id in ('${snap}','${snap2}'); delete from public.club_imports where id in ('${imp}','${imp2}');
   delete from public.alliance_leaders where alliance_id='${alliance}'; delete from public.club_alliance_members where alliance_id='${alliance}'; delete from public.club_alliances where id='${alliance}';`);
 }
});
