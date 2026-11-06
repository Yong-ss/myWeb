import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,baseURL,users,password,clubId,foreignClubId,playerId} from './local.mjs';
// Highland Race on real Supabase Auth + Worker + database (synthetic data only). The owner imports a faction-wide board
// through the real page: only this club's confirmed player is saved, and no other club's name or number reaches any
// table or the log. Then: separation from the Four-Way League (same day, both directions of every API, independent
// permissions), alliance read-only access, versions, faction and rank, and attendance.
const out=(name,kills,merit=2000)=>({player_name:name,faction_name:'血皇帝势力',kills,assists:3,dispersals:0,awakens:1,merit});
const str=name=>({player_name:name,faction_name:'血皇帝势力',player_damage:'1708万',damage_taken:'462.7万',healing:0,purification:0});
const outsider='高原路人甲',departed='高原旧人';
const raw=JSON.stringify({schema_version:1,event_type:'highland_race',
 output:[out(outsider,30,2846),out('集成测试玩家',9),out(departed,4),out('集成测试玩家',9)],strategy:[str(departed),str('集成测试玩家'),str(outsider),str('高原路人乙')]});
const D='2019-07-01';

test('highland race: faction-wide import keeps only our player, separate from the four-way league, read-only alliance, versions, attendance',async({page,request})=>{
 test.setTimeout(150000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const alliance=randomUUID(),snap=randomUUID(),latest=randomUUID(),imp=randomUUID(),imp2=randomUUID(),old=randomUUID();
 // Member history: the seeded player is in the club on 2019-06-28 and in the latest roster (dated after every other
 // spec's data); a departed player of this club shares a name with someone on the board.
 sql(`insert into public.club_players(id,club_id,display_name,match_name) values('${old}','${clubId}','${departed}','${departed}');
  insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values('${imp}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}'),('${imp2}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}');
  insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id) values('${snap}','${clubId}','2019-06-28',1,'${imp}'),('${latest}','${clubId}','2099-12-31',1,'${imp2}');
  insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name) values('${clubId}','${snap}','${playerId}','集成测试玩家'),('${clubId}','${latest}','${playerId}','集成测试玩家'),('${clubId}','${snap}','${old}','${departed}');
  insert into public.club_alliances(id,name) values('${alliance}','Highland alliance');
  insert into public.club_alliance_members(alliance_id,club_id) values('${alliance}','${clubId}');
  insert into public.alliance_leaders(alliance_id,user_id) values('${alliance}','${users.outsider.id}');`);
 try{
  // 1. The owner imports through the real page: our player is proposed, the departed name waits, the outsiders are excluded.
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/highland/import?club=${clubId}`);
  await page.getByLabel('比赛日期').fill(D);await page.getByLabel('本俱乐部总积分').fill('3000');
  await page.getByLabel('势力名次（可留空）').selectOption('2');await page.getByLabel('AI 输出的 JSON').fill(raw);
  await page.getByRole('button',{name:'开始核对'}).click();
  await expect(page.getByText('已合并 1 条完全相同的重复行')).toBeVisible();
  await expect(page.getByLabel('核对进度')).toContainText('拟纳入本俱乐部1 人');
  await expect(page.getByLabel('待确认').getByText('不在最新成员名单')).toHaveCount(2);
  // The departed name on the board is another club's player here: exclude both rows.
  await page.getByRole('button',{name:'其余待确认全部排除…'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'全部排除'}).click();
  await page.getByRole('button',{name:'下一步 →'}).click();await page.getByRole('button',{name:'核对名单并保存'}).click();
  const confirm=page.getByRole('alertdialog');await confirm.getByText(/我已核对/).click();await confirm.getByRole('button',{name:'确认保存'}).click();
  await expect(page).toHaveURL(/\/highland\/event\?/);
  await expect(page.getByRole('heading',{name:`高原竞逐 · ${D}`})).toBeVisible();
  const owner=(await auth('owner')).access_token,admin=(await auth('admin')).access_token,leader=(await auth('outsider')).access_token,foreign=(await auth('foreign')).access_token;
  const list=await (await get(`highland-events?club=${clubId}`,owner)).json();
  const ev=list.events.find(e=>e.event_date===D);
  expect(ev).toMatchObject({total_score:3000,participants:1,total_kills:9,total_merit:2000,faction:null,faction_rank:2,version:1});
  const detail=await (await get(`highland-event?club=${clubId}&id=${ev.id}`,owner)).json();
  expect(detail.players).toEqual([expect.objectContaining({player_id:playerId,kills:9,merit:2000,player_damage:17080000,damage_taken:4627000,origin:'import'})]);
  expect(detail.raw_text).toBeUndefined();
  // Nothing about the other clubs' players is stored anywhere: results, versions, log.
  for(const name of [outsider,'高原路人乙'])expect(Number(sql(`select (select count(*) from public.club_highland_event_players where output_name like '%${name}%' or strategy_name like '%${name}%')
   +(select count(*) from public.club_event_versions where state::text like '%${name}%')+(select count(*) from public.club_audit_events where details::text like '%${name}%')
   +(select count(*) from public.club_event_imports where raw_text like '%${name}%');`))).toBe(0);
  expect(JSON.parse(sql(`select details->'reported_source' from public.club_audit_events where action='highland_created' and target_id='${ev.id}';`))).toEqual({output_rows:3,strategy_rows:4,excluded_rows:5});

  // 2. A Four-Way League on the same day is independent; neither API family answers for the other's events.
  const fwPlayers=[{player_id:playerId,name:null,output_name:null,strategy_name:null,remember_alias:false,kills:1,assists:0,dispersals:0,awakens:0,player_damage:0,damage_taken:0,healing:0,guardian_damage:0,purification:0}];
  const fwRaw=JSON.stringify({schema_version:1,event_type:'four_way_league',output:[{player_name:'x'}],strategy:[{player_name:'x'}]});
  const fw=await post(`events?club=${clubId}`,owner,{event_date:D,total_score:1,players:fwPlayers,raw_text:fwRaw,request_id:randomUUID()});
  expect(fw.status()).toBe(200);const fwId=(await fw.json()).event_id;
  expect((await (await get(`events?club=${clubId}`,owner)).json()).events.map(e=>e.id)).not.toContain(ev.id);
  expect((await (await get(`highland-events?club=${clubId}`,owner)).json()).events.map(e=>e.id)).not.toContain(fwId);
  expect((await get(`event?club=${clubId}&id=${ev.id}`,owner)).status()).toBe(404);
  expect((await get(`event?club=${clubId}&id=${ev.id}&version=1`,owner)).status()).toBe(404);
  expect((await get(`highland-event?club=${clubId}&id=${fwId}`,owner)).status()).toBe(404);
  expect((await post(`event?club=${clubId}`,owner,{event_id:ev.id,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(400);
  expect((await post(`highland-event?club=${clubId}`,owner,{event_id:fwId,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(400);
  // Same highland date again is refused; the tables are closed to clients.
  const hlPlayers=[{player_id:playerId,output_name:null,strategy_name:null,remember_alias:false,kills:0,assists:0,dispersals:0,awakens:0,merit:0,player_damage:0,damage_taken:0,healing:0,purification:0}];
  const create=(t,date=D,players=hlPlayers)=>post(`highland-events?club=${clubId}`,t,{event_date:date,total_score:1,faction:null,faction_rank:null,players,source:{output_rows:1,strategy_rows:1,excluded_rows:0},request_id:randomUUID()});
  expect((await create(admin)).status()).toBe(409);
  expect((await create(admin,'2019-07-02',[])).status()).toBe(400); // zero participants
  expect((await create(admin,'2019-07-02',[{...hlPlayers[0],player_id:null}])).status()).toBe(400); // never a new identity via the database
  expect((await rest('club_highland_event_players?select=*',owner)).status).not.toBe(200);

  // 3. Independent permissions: four-way denials do not touch highland, and the reverse.
  const setAdmin=(permission,value)=>post(`team/personal?club=${clubId}`,owner,{user_id:users.admin.id,permission,value});
  expect((await setAdmin('events.read',false)).status()).toBe(200);
  expect((await get(`events?club=${clubId}`,admin)).status()).toBe(403);
  expect((await get(`highland-events?club=${clubId}`,admin)).status()).toBe(200);
  expect((await setAdmin('events.read',null)).status()).toBe(200);
  expect((await setAdmin('highland.read',false)).status()).toBe(200);
  expect((await get(`highland-events?club=${clubId}`,admin)).status()).toBe(403);
  expect((await rest('rpc/club_highland_list',admin,{p_club:clubId})).status).toBe(403);
  expect((await create(admin,'2019-07-03')).status()).toBe(403); // import needs highland.read
  expect((await get(`events?club=${clubId}`,admin)).status()).toBe(200);
  expect((await setAdmin('highland.read',null)).status()).toBe(200);

  // 4. Alliance leader: reads; never writes or reads the names for matching. Another club sees nothing.
  expect((await (await get(`account?club=${clubId}`,leader)).json()).permissions).toContain('highland.read');
  expect((await (await get(`highland-event?club=${clubId}&id=${ev.id}`,leader)).json()).players).toHaveLength(1);
  expect((await get(`player-highland?club=${clubId}&player=${playerId}`,leader)).status()).toBe(200);
  expect((await get(`highland-identities?club=${clubId}`,leader)).status()).toBe(403);
  expect((await post(`highland-event?club=${clubId}`,leader,{event_id:ev.id,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(403);
  expect((await get(`highland-events?club=${clubId}`,foreign)).status()).toBe(403);
  expect((await rest('rpc/club_highland_detail',foreign,{p_club:clubId,p_event:ev.id})).status).toBe(403);
  expect((await post(`highland-event?club=${foreignClubId}`,foreign,{event_id:ev.id,expected_version:1,action:'void',payload:{},request_id:randomUUID()})).status()).toBe(400);

  // 5. Versions: faction set, retry replayed once, stale refused; never down to zero participants.
  const edit=body=>post(`highland-event?club=${clubId}`,admin,{event_id:ev.id,request_id:randomUUID(),...body});
  const f1={event_id:ev.id,expected_version:1,action:'faction',payload:{faction:'血皇帝势力',faction_rank:1},request_id:randomUUID()};
  expect((await post(`highland-event?club=${clubId}`,admin,f1)).status()).toBe(200);
  expect(await (await post(`highland-event?club=${clubId}`,admin,f1)).json()).toMatchObject({version:2,replayed:true});
  expect((await edit({expected_version:1,action:'score',payload:{total_score:1}})).status()).toBe(409);
  expect((await edit({expected_version:2,action:'faction',payload:{faction:'臆造势力',faction_rank:1}})).status()).toBe(400);
  expect((await edit({expected_version:2,action:'remove',payload:{player_id:playerId}})).status()).toBe(409);
  // The departed player can be added manually (history link), then rebinding onto them is refused (already there).
  const added=await edit({expected_version:2,action:'add',payload:{player_id:old,kills:0,assists:0,dispersals:0,awakens:0,merit:0,player_damage:0,damage_taken:0,healing:0,purification:0}});
  expect(added.status()).toBe(200);
  expect((await edit({expected_version:3,action:'rebind',payload:{from_player:playerId,to_player:old}})).status()).toBe(409);
  const v=await (await get(`highland-event?club=${clubId}&id=${ev.id}&version=2`,owner)).json();
  expect(v.state).toMatchObject({faction:'血皇帝势力',faction_rank:1});
  expect(v.state.players).toHaveLength(1);

  // 6. Attendance is per type: the highland event counts in highland only; voiding removes it.
  let hl=await (await get(`player-highland?club=${clubId}&player=${playerId}`,owner)).json();
  expect(hl.attended.map(a=>a.event_id)).toContain(ev.id);expect(hl.attended[0]).toHaveProperty('merit');
  const fwAtt=await (await get(`player-events?club=${clubId}&player=${playerId}`,owner)).json();
  expect(fwAtt.attended.map(a=>a.event_id)).toContain(fwId);expect(fwAtt.attended.map(a=>a.event_id)).not.toContain(ev.id);
  expect((await edit({expected_version:3,action:'void',payload:{}})).status()).toBe(200);
  hl=await (await get(`player-highland?club=${clubId}&player=${playerId}`,owner)).json();
  expect(hl.attended.map(a=>a.event_id)).not.toContain(ev.id);
  expect(Number(sql(`select count(*) from public.club_audit_events where club_id='${clubId}' and action like 'highland\\_%' and target_id='${ev.id}';`))).toBe(4);
 }finally{
  sql(`set session_replication_role=replica;
   delete from public.club_highland_event_players where club_id='${clubId}';
   delete from public.club_event_versions where club_id='${clubId}'; delete from public.club_event_imports where club_id='${clubId}';
   delete from public.club_event_players where club_id='${clubId}'; delete from public.club_events where club_id='${clubId}';
   delete from public.club_audit_events where club_id='${clubId}' and (action like 'highland\\_%' or action like 'event\\_%');
   delete from public.club_audit_events where club_id='${clubId}' and action='admin_permission_changed' and (details->>'permission' like 'events.%' or details->>'permission' like 'highland.%');
   delete from public.platform_audit_events where action like 'club_permission_overrides.%' and (coalesce(details#>>'{new,permission_key}',details#>>'{old,permission_key}') like 'events.%' or coalesce(details#>>'{new,permission_key}',details#>>'{old,permission_key}') like 'highland.%');
   delete from public.club_permission_overrides where club_id='${clubId}' and user_id='${users.admin.id}' and (permission_key like 'events.%' or permission_key like 'highland.%');
   set session_replication_role=origin;
   delete from public.club_snapshot_players where snapshot_id in ('${snap}','${latest}'); delete from public.club_snapshots where id in ('${snap}','${latest}'); delete from public.club_imports where id in ('${imp}','${imp2}');
   delete from public.club_players where id='${old}';
   delete from public.alliance_leaders where alliance_id='${alliance}'; delete from public.club_alliance_members where alliance_id='${alliance}'; delete from public.club_alliances where id='${alliance}';`);
 }
});
