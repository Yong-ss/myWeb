import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,localFetch,state,totp,clubId,foreignClubId,playerId,foreignPlayerId,baseURL,users,password} from './local.mjs';
// Stage F on real Supabase Auth + Worker + database. Club A (clubId) and B (foreignClubId); a third club C is created
// here in another alliance. The outsider becomes a leader with no club role; foreign (owner of B) also leads one.
const authApi=(path,token,body)=>localFetch(`/auth/v1/${path}`,{method:'POST',headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('alliances: platform admin appoints, leader reads only its alliance read-only, joins need the leader, every change applies at once',async({request,page})=>{
 test.setTimeout(150000);
 const cookie=t=>({Cookie:`__Host-club_access=${t}`});
 const get=(path,t)=>request.get(`${baseURL}/api/${path}`,{headers:cookie(t)});
 const post=(path,t,data)=>request.post(`${baseURL}/api/${path}`,{headers:{...cookie(t),Origin:baseURL},data});
 const C=randomUUID(),factors=[],S=randomUUID(),I=randomUUID(),D='2020-03-01';
 sql(`insert into public.club_clubs(id,name) values('${C}','Integration club C');
  insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) values('${I}','${clubId}','${users.owner.id}','{"secret":"raw json"}',1,'${randomUUID()}');
  insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster,is_current) values('${S}','${clubId}','${D}',1,'${I}',true,true);
  insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score) values('${clubId}','${S}','${playerId}','联盟可见成员',321);
  insert into public.club_audit_events(club_id,actor_id,action,details) values('${clubId}','${users.owner.id}','import_date_deleted','{"date":"2019-01-01","versions":1}');`);
 try{
  // An active platform admin (own TOTP, no SQL Editor) — the admin account, made platform admin directly here.
  sql(`insert into public.platform_role_assignments(user_id,role) values('${users.admin.id}','platform_admin') on conflict (user_id,role) do update set status='active';`);
  const aal1=(await auth('admin')).access_token;
  const factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'Alliance PA'})).json();factors.push(factor.id);
  let pa;for(let i=0;i<2&&!pa;i++){const ch=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();pa=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:ch.id,code:totp(factor.totp.secret)})).json()).access_token;}
  // Without MFA, or as an ordinary owner: no alliance management through the Worker or the database.
  for(const t of [aal1,(await auth('foreign')).access_token]){
   expect((await post('admin/alliance',t,{alliance_id:null,name:'Forged',status:'active'})).status()).toBe(403);
   expect((await rest('rpc/platform_save_alliance',t,{p_alliance:null,p_name:'Forged',p_status:'active'})).status).toBe(403);
  }
  const create=async name=>(await (await post('admin/alliance',pa,{alliance_id:null,name,status:'active'})).json()).id;
  const one=await create('Integration Alliance One'),two=await create('Integration Alliance Two');
  expect((await post('admin/club-alliance',pa,{club_id:clubId,alliance_id:one})).status()).toBe(200);
  expect((await post('admin/club-alliance',pa,{club_id:C,alliance_id:two})).status()).toBe(200);
  expect((await post('admin/alliance-leader',pa,{alliance_id:one,email:users.outsider.email,action:'grant'})).status()).toBe(200);
  expect((await post('admin/alliance-leader',pa,{alliance_id:two,email:users.foreign.email,action:'grant'})).status()).toBe(200);
  expect((await post('admin/alliance-leader',pa,{alliance_id:two,email:users.owner.email,action:'grant'})).status()).toBe(409); // one leader per alliance
  expect(Number(sql(`select count(*) from public.platform_audit_events where actor_id='${users.admin.id}' and action in ('club_alliances.insert','club_alliance_members.insert','alliance_leaders.insert');`))).toBe(6);

  // The leader has no club role: signs in, lands in the alliance workspace, sees exactly alliance One.
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.outsider.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/alliance$/);
  await expect(page.getByRole('heading',{name:'Integration Alliance One',level:1})).toBeVisible();
  const leader=(await auth('outsider')).access_token;
  const mine=await (await get('alliance',leader)).json();expect(mine.clubs.map(c=>c.id)).toEqual([clubId]);
  // Read-only access to A through the normal club routes and RLS; nothing in B (no alliance) or C (other alliance).
  expect((await (await get(`account?club=${clubId}`,leader)).json()).permissions).toEqual(['audit.read','events.read','highland.read','members.read']);
  expect((await get(`members?club=${clubId}&player=${playerId}&paged=1`,leader)).status()).toBe(200);
  expect((await get(`activity?club=${clubId}`,leader)).status()).toBe(200);
  for(const club of [foreignClubId,C])for(const path of [`members?club=${club}`,`activity?club=${club}`])expect((await get(path,leader)).status(),path).toBe(403);
  expect(await (await rest(`club_players?select=id&club_id=eq.${foreignClubId}`,leader)).json()).toEqual([]);
  expect((await (await rest(`club_players?select=id&club_id=eq.${clubId}`,leader)).json()).length).toBeGreaterThan(0);
  // The agreed read scope, through the Worker as the pages call it: members (roster of a day), the daily import records
  // (dates and versions), a player's history, analytics (score trend) and the club log.
  const roster=await (await get(`members?club=${clubId}&date=${D}`,leader)).json();
  expect(roster.members.map(m=>m.read_name)).toContain('联盟可见成员'); // shown under the confirmed name, the day's reading kept
  expect(roster.snapshots.some(x=>x.snapshot_date===D&&x.revision===1)).toBe(true);
  expect((await (await get(`members?club=${clubId}&date=${D}&version=${S}`,leader)).json()).snapshot.id).toBe(S);
  const history=await (await get(`members?club=${clubId}&player=${playerId}&paged=1`,leader)).json();expect(history.timeline.some(t=>t.date===D)).toBe(true);
  expect((await (await get(`members?club=${clubId}&trend=1&before=2020-03-02`,leader)).json()).points.some(x=>x.date===D&&x.score===321)).toBe(true);
  const log=await (await get(`activity?club=${clubId}`,leader)).json();expect(log.events.some(e=>e.action==='import_date_deleted')).toBe(true);
  // ...and on the real pages, read-only.
  await page.goto(`/members?club=${clubId}&date=${D}`);await expect(page.getByRole('link',{name:'集成测试玩家'})).toHaveAttribute('title',/联盟可见成员/);
  await expect(page.getByRole('link',{name:'导入数据'})).toHaveCount(0);await expect(page.getByRole('button',{name:'删除当天数据'})).toHaveCount(0);
  await page.goto(`/players?id=${playerId}&club=${clubId}`);await expect(page.getByRole('cell',{name:D})).toBeVisible();
  await page.goto(`/account?club=${clubId}`);await expect(page.getByRole('heading',{name:'俱乐部总览'})).toBeVisible();await expect(page.getByText('此账户没有权限')).toHaveCount(0);
  await page.goto(`/activity?club=${clubId}`);await expect(page.getByText('删除').first()).toBeVisible();
  // No raw import JSON and no actor emails, even directly.
  expect(await (await rest(`club_imports?select=raw_text&club_id=eq.${clubId}`,leader)).json()).toEqual([]);
  expect(JSON.stringify(await (await get(`activity?club=${clubId}`,leader)).json())).not.toContain('@club.test');
  // Never a write, whatever the URL or body says.
  for(const [path,body] of [['imports',{}],['delete-import',{date:'2026-10-01',expected_snapshot_id:randomUUID(),confirmed:true}],['club-settings',{name:'x',expected_name:'y'}],
   ['team/role',{user_id:users.admin.id,action:'revoke',expected_version:0,request_id:randomUUID()}],['club-alliance',{action:'withdraw'}],['resolve-absence',{snapshot_id:randomUUID(),player_id:playerId,decision:'left'}]])
   expect((await post(`${path}?club=${clubId}`,leader,body)).status(),path).toBe(403);
  expect((await rest('rpc/club_rename',leader,{p_club_id:clubId,p_name:'Taken',p_expected:sql(`select name from public.club_clubs where id='${clubId}';`)})).status).toBe(403);
  expect((await post('admin/club-alliance',leader,{club_id:foreignClubId,alliance_id:one})).status()).toBe(403);

  // A Super Admin forced deny wins over the alliance path: Worker, direct RPC and RLS, at once; lifting restores it.
  const saAal1=(await auth('owner')).access_token,saFactor=await (await authApi('factors',saAal1,{factor_type:'totp',friendly_name:'Alliance SA'})).json();factors.push(saFactor.id);
  let sa;for(let i=0;i<2&&!sa;i++){const ch=await (await authApi(`factors/${saFactor.id}/challenge`,saAal1,{})).json();sa=(await (await authApi(`factors/${saFactor.id}/verify`,saAal1,{challenge_id:ch.id,code:totp(saFactor.totp.secret)})).json()).access_token;}
  sql(`select club_private.trust_super_admin_factor('${saFactor.id}');`);
  const deny=value=>post('admin/personal-permission',sa,{club_id:clubId,user_id:users.outsider.id,permission:'audit.read',value});
  expect((await post('admin/personal-permission',pa,{club_id:clubId,user_id:users.outsider.id,permission:'audit.read',value:false})).status()).toBe(403); // platform admins cannot
  expect((await deny(true)).status()).toBe(409); // only a deny for a leader without a club role
  expect((await deny(false)).status()).toBe(200);
  expect((await (await get(`account?club=${clubId}`,leader)).json()).permissions).toEqual(['events.read','highland.read','members.read']);
  expect((await get(`activity?club=${clubId}`,leader)).status()).toBe(403);
  expect((await (await rest('rpc/club_activity',leader,{p_club_id:clubId})).json()).events).toEqual([]);
  expect((await rest(`club_audit_events?select=id&club_id=eq.${clubId}`,leader)).status).toBe(403); // the table itself is closed to clients
  expect((await get(`members?club=${clubId}&date=${D}`,leader)).status()).toBe(200); // the other read stays
  expect((await deny(null)).status()).toBe(200);
  expect((await get(`activity?club=${clubId}`,leader)).status()).toBe(200);
  // Leader and owner at once: foreign leads Two and owns B. B is theirs (full owner powers); C read-only; A nothing.
  const foreign=(await auth('foreign')).access_token;
  expect((await (await get(`account?club=${foreignClubId}`,foreign)).json()).permissions).toContain('club.rename');
  expect((await (await get(`account?club=${C}`,foreign)).json()).permissions).toEqual(['audit.read','events.read','highland.read','members.read']);
  expect((await get(`members?club=${clubId}`,foreign)).status()).toBe(403);
  // A forced deny in the alliance club holds for the owner-leader too; their own club is unaffected, and they can
  // still decide join requests (below).
  expect((await post('admin/personal-permission',sa,{club_id:C,user_id:users.foreign.id,permission:'members.read',value:false})).status()).toBe(200);
  expect((await (await get(`account?club=${C}`,foreign)).json()).permissions).toEqual(['audit.read','events.read','highland.read']);
  expect((await get(`members?club=${C}`,foreign)).status()).toBe(403);
  expect(await (await rest(`club_players?select=id&club_id=eq.${C}`,foreign)).json()).toEqual([]);
  expect((await (await get(`account?club=${foreignClubId}`,foreign)).json()).permissions).toContain('members.read');

  // Join flow: B's owner asks to join One; only One's leader decides; approval applies at once.
  expect((await post(`club-alliance?club=${foreignClubId}`,foreign,{action:'request',alliance_id:one})).status()).toBe(200);
  const pending=(await (await get('alliance',leader)).json()).requests;expect(pending.map(r=>r.club_id)).toEqual([foreignClubId]);
  expect((await post('alliance/decide',foreign,{request_id:pending[0].id,decision:'approve'})).status()).toBe(403); // Two's leader
  expect((await get(`members?club=${foreignClubId}`,leader)).status()).toBe(403);
  expect((await post('alliance/decide',leader,{request_id:pending[0].id,decision:'approve'})).status()).toBe(200);
  expect((await get(`members?club=${foreignClubId}&player=${foreignPlayerId}&paged=1`,leader)).status()).toBe(200);
  expect((await post('alliance/decide',leader,{request_id:pending[0].id,decision:'approve'})).status()).toBe(409);

  // Removal of the club and revocation of the leader apply to the very next request.
  expect((await post('admin/club-alliance',pa,{club_id:foreignClubId,alliance_id:null})).status()).toBe(200);
  expect((await get(`members?club=${foreignClubId}`,leader)).status()).toBe(403);
  expect((await post('admin/alliance-leader',pa,{alliance_id:one,email:null,action:'revoke'})).status()).toBe(200);
  expect((await get(`members?club=${clubId}`,leader)).status()).toBe(403);
  expect((await get('alliance',leader)).status()).toBe(403);
  expect((await request.post(`${baseURL}/api/login`,{headers:{Origin:baseURL},data:{email:users.outsider.email,password}})).status()).toBe(403); // no authorization left
 }finally{
  sql(`delete from public.club_snapshot_players where snapshot_id='${S}'; delete from public.club_snapshots where id='${S}'; delete from public.club_imports where id='${I}';
   delete from public.club_permission_overrides where user_id in ('${users.outsider.id}','${users.foreign.id}');
   delete from public.alliance_leaders; delete from public.club_alliance_requests; delete from public.club_alliance_members; delete from public.club_alliances;
   delete from public.club_clubs where id='${C}'; update public.platform_role_assignments set status='revoked' where user_id='${users.admin.id}';
   ${factors.map(f=>`delete from auth.mfa_factors where id='${f}';`).join('')}`);
 }
});
