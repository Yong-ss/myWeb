import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,sql,baseURL,users,password,clubId,foreignClubId,playerId} from './local.mjs';
// Dragon Hunt on real Supabase Auth + Worker + database (synthetic data only). The owner imports a screenshot name
// list through the real page: the exact name is matched, a similar name is picked by hand, an unknown name is left
// out (counted only). Then: attendance and absence on the profile API, one hunt per day, void frees the date, and
// another club's owner reads nothing.
const D='2019-08-01';
const raw=JSON.stringify({schema_version:1,event_type:'dragon_hunt',participants:[{player_name:'集成测试玩家'},{player_name:'猎龙旧友丶'},{player_name:'名单外新人'},{player_name:'集成测试玩家'}]});

test('dragon hunt: import matches members, leaves unknown names out, counts attendance and absence, one per day, void frees the date',async({page,request})=>{
 test.setTimeout(120000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const friend=randomUUID(),absent=randomUUID(),before=randomUUID(),after=randomUUID(),imp=randomUUID(),imp2=randomUUID(),revised=randomUUID(),revisionImport=randomUUID();
 // The seeded player, a friend (read as a similar name) and a member who skipped: all in the rosters around D.
 sql(`insert into public.club_players(id,club_id,display_name,match_name) values('${friend}','${clubId}','猎龙旧友','猎龙旧友'),('${absent}','${clubId}','猎龙缺席者','猎龙缺席者');
  insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values('${imp}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}'),('${imp2}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}');
  insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id) values('${before}','${clubId}','2019-07-30',1,'${imp}'),('${after}','${clubId}','2019-08-02',1,'${imp2}');
  insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name) select '${clubId}',s,p,'x' from unnest(array['${before}','${after}']::uuid[]) s, unnest(array['${playerId}','${friend}','${absent}']::uuid[]) p;`);
 try{
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/dragon/import?club=${clubId}`);
  await page.getByLabel('猎龙日期').fill(D);await page.getByLabel('AI 输出的 JSON').fill(raw);
  await page.getByRole('button',{name:'开始核对'}).click();
  await expect(page.getByText('已合并 1 个重复名字')).toBeVisible();
  await expect(page.getByLabel('核对进度')).toContainText('已匹配1 人');
  await expect(page.getByLabel('核对进度')).toContainText('不计入1 个');
  // The similar name waits; pick the friend by hand.
  await page.getByLabel('待确认').getByRole('button',{name:'选择玩家'}).click();
  const picker=page.getByRole('dialog');await picker.getByRole('button',{name:/^猎龙旧友/}).click();await picker.getByRole('button',{name:'确认',exact:true}).click();
  await page.getByRole('button',{name:'保存出勤'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认保存'}).click();
  await expect(page).toHaveURL(/\/dragon\/event\?/);
  await expect(page.getByRole('heading',{name:`${D} 猎龙`})).toBeVisible();

  const owner=(await auth('owner')).access_token,foreign=(await auth('foreign')).access_token;
  const list=await (await get(`dragon-events?club=${clubId}`,owner)).json();
  const ev=list.events.find(e=>e.event_date===D);
  expect(ev).toMatchObject({participants:2,version:1});
  const detail=await (await get(`dragon-event?club=${clubId}&id=${ev.id}`,owner)).json();
  expect(detail.players.map(p=>p.player_id).sort()).toEqual([playerId,friend].sort());
  // A later change must never rewrite the pathway shown for a past hunt.
  sql(`update public.club_snapshot_players set pathway=case when snapshot_id='${before}' then '观众' else '战士' end where club_id='${clubId}' and player_id='${playerId}' and snapshot_id in ('${before}','${after}','${revised}');`);
  const enriched=await (await get(`dragon-event?club=${clubId}&id=${ev.id}`,owner)).json();
  expect(enriched.players.find(p=>p.player_id===playerId).pathway).toBe('观众');
  expect(enriched.players.find(p=>p.player_id===friend).pathway).toBeNull();
  expect((await get(`dragon-event?club=${foreignClubId}&id=${ev.id}`,foreign)).status()).toBe(404);
  // The unknown name is never stored; only its count is logged.
  expect(Number(sql(`select (select count(*) from public.club_dragon_event_players where read_name like '%名单外新人%')+(select count(*) from public.club_event_versions where state::text like '%名单外新人%')+(select count(*) from public.club_audit_events where details::text like '%名单外新人%');`))).toBe(0);
  expect(JSON.parse(sql(`select details->'unmatched' from public.club_audit_events where action='dragon_created' and target_id='${ev.id}';`))).toBe(1);

  // Attendance on the profile API: attended for both, absent for the member in the rosters who was not there.
  const att=async p=>(await get(`player-dragon?club=${clubId}&player=${p}`,owner)).json();
  expect((await att(playerId)).attended.map(a=>a.event_id)).toContain(ev.id);
  expect((await att(absent)).absent.map(a=>a.event_id)).toContain(ev.id);
  expect((await get(`player-dragon?club=${clubId}&player=${playerId}`,foreign)).status()).toBe(403);
  expect((await get(`dragon-events?club=${clubId}`,foreign)).status()).toBe(403);

  // Exact-day roster only: neither earlier nor future members may be labelled absent.
  const readDetail=async()=>(await get(`dragon-event?club=${clubId}&id=${ev.id}`,owner)).json();
  expect((await readDetail()).roster).toBeNull();
  sql(`update public.club_snapshots set snapshot_date='${D}',is_complete_roster=false where id='${before}';`);
    sql(`insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values('${revisionImport}','${clubId}','${users.owner.id}','{}',1,'${randomUUID()}');
   update public.club_snapshots set is_current=false where id='${before}';
   insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,supersedes_id,is_complete_roster) values('${revised}','${clubId}','${D}',2,'${revisionImport}','${before}',false);
   insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,pathway) select club_id,'${revised}',player_id,name,pathway from public.club_snapshot_players where snapshot_id='${before}';`);
  const day=await readDetail();
  expect(day.roster).toMatchObject({date:D,revision:2,complete:false});
  expect(day.absent.map(p=>p.player_id)).toEqual([absent]);
  sql(`delete from public.club_snapshot_players where snapshot_id='${revised}' and player_id='${absent}';`);
  expect((await readDetail()).absent).toEqual([]); // still appears in the later roster
  sql(`update public.club_snapshots set deleted_at=now() where id='${revised}';`);
  expect((await readDetail()).roster).toBeNull();
  expect((await readDetail()).absent).toEqual([]);

  // One hunt per day; void frees the date and stops counting.
  const again={event_date:D,players:[{player_id:absent,read_name:null,remember_alias:false}],unmatched:0};
  expect((await post(`dragon-events?club=${clubId}`,owner,{...again,request_id:randomUUID()})).status()).toBe(409);
  expect((await post(`dragon-event?club=${clubId}`,owner,{event_id:ev.id,expected_version:1,request_id:randomUUID()})).status()).toBe(200);
  expect((await att(absent)).absent.map(a=>a.event_id)).not.toContain(ev.id);
  expect((await readDetail()).absent).toEqual([]);
  expect((await post(`dragon-events?club=${clubId}`,owner,{...again,request_id:randomUUID()})).status()).toBe(200);
 }finally{
  sql(`set session_replication_role=replica;
   delete from public.club_dragon_event_players where club_id='${clubId}';
   delete from public.club_event_versions where club_id='${clubId}' and event_id in (select id from public.club_events where club_id='${clubId}' and event_type='dragon_hunt');
   delete from public.club_events where club_id='${clubId}' and event_type='dragon_hunt';
   delete from public.club_audit_events where club_id='${clubId}' and action like 'dragon\\_%';
   set session_replication_role=origin;
   delete from public.club_snapshot_players where snapshot_id in ('${before}','${after}','${revised}'); delete from public.club_snapshots where id in ('${before}','${after}','${revised}'); delete from public.club_imports where id in ('${imp}','${imp2}','${revisionImport}');
   delete from public.club_player_aliases where player_id in ('${friend}','${absent}'); delete from public.club_players where id in ('${friend}','${absent}');`);
 }
});
