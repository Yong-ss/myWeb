import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,clubId,foreignClubId,playerId,baseURL,users,password} from './local.mjs';
test('audited date deletion hides every version, isolates tenants and permits safe reimport',async({page,context,request})=>{
 await context.route('**/*',r=>new URL(r.request().url()).origin===baseURL?r.continue():r.abort());
 const owner=(await auth('owner')).access_token,admin=(await auth('admin')).access_token;
 const date='2001-02-03';
 const row={player_id:playerId,name:'集成测试玩家',position:null,level:70,pathway:null,extraordinary_score:1,prosperity:null,weekly_activity:null,group:null,join_days:null,identity_confirmed:true};
 const payload={p_club_id:clubId,p_date:date,p_complete:true,p_mode:'replace',p_rows:[row],p_raw:'synthetic fixture',p_request_id:randomUUID(),p_expected:null,p_confirmed:true};
 const commit=async(p)=>{const r=await rest('rpc/club_commit_import',owner,p);expect(r.ok,await r.clone().text()).toBe(true);return r.json();};
 const first=await commit(payload),second=await commit({...payload,p_request_id:randomUUID(),p_expected:first.snapshot_id,p_rows:[{...row,extraordinary_score:2}]});
 const deletion={p_club_id:clubId,p_date:date,p_expected:second.snapshot_id};
 for(const role of ['outsider','foreign'])expect((await rest('rpc/club_delete_import_date',(await auth(role)).access_token,deletion)).status).toBe(403);
 expect((await rest('rpc/club_delete_import_date',owner,{...deletion,p_club_id:foreignClubId})).status).toBe(403);
 expect((await rest('rpc/club_delete_import_date',admin,{...deletion,p_expected:first.snapshot_id})).status).toBe(409);
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.admin.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/account$/);
 await page.goto(`/members?date=${date}`);await page.getByRole('button',{name:'删除当天数据',exact:true}).click();
 const dialog=page.getByRole('alertdialog');await expect(dialog.getByRole('button',{name:'确认删除',exact:true})).toBeDisabled();await dialog.getByLabel(`输入日期 ${date} 确认`).fill(date);await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog).not.toBeVisible();
 for(const table of ['club_snapshots','club_snapshot_players','club_imports']){
  const query=table==='club_snapshots'?`snapshot_date=eq.${date}`:table==='club_snapshot_players'?`snapshot_id=in.(${first.snapshot_id},${second.snapshot_id})`:`id=in.(${sql(`select string_agg(import_id::text,',') from public.club_snapshots where club_id='${clubId}' and snapshot_date='${date}';` )})`;
  expect(await (await rest(`${table}?${query}`,owner)).json()).toEqual([]);
 }
 expect((await rest('rpc/club_commit_import',owner,payload)).status).toBe(409);
 const hiddenVersion=await context.request.get(`${baseURL}/api/members?date=${date}&version=${first.snapshot_id}`);expect(hiddenVersion.status()).toBe(404);
 const hiddenHistory=await context.request.get(`${baseURL}/api/members?player=${playerId}&paged=1`);expect(hiddenHistory.ok()).toBe(true);expect(JSON.stringify(await hiddenHistory.json())).not.toContain(date);
 expect((await rest('rpc/club_delete_import_date',admin,deletion)).ok).toBe(true);
 let logs=await (await rest(`club_audit_events?club_id=eq.${clubId}&action=eq.import_date_deleted`,owner)).json();logs=logs.filter(l=>l.details?.date===date);expect(logs).toHaveLength(1);expect(logs[0].details).toMatchObject({date,versions:2,actor_email:users.admin.email,actor_role:'admin'});
 expect((await rest('club_audit_events',owner,{action:'forged'})).status).toBe(403);
 expect((await rest(`club_audit_events?id=eq.${logs[0].id}`,owner,{},'DELETE')).status).toBe(403);
 const restored=await commit({...payload,p_request_id:randomUUID()});expect(restored.revision).toBe(3);
 expect((await rest('rpc/club_delete_import_date',admin,deletion)).status).toBe(409);
 const visible=await (await rest(`club_snapshots?snapshot_date=eq.${date}`,owner)).json();expect(visible).toHaveLength(1);expect(visible[0].id).toBe(restored.snapshot_id);
 await rest('rpc/club_delete_import_date',owner,{...deletion,p_expected:restored.snapshot_id});
 // Equal timestamps stress the UUID tie-breaker; only the disposable database is seeded.
 sql(`insert into public.club_audit_events(club_id,actor_id,action,created_at) select '${clubId}','${users.owner.id}','fixture',timestamptz '2000-01-01' from generate_series(1,60);`);
 const seen=new Set();let cursor=null;do{const r=await rest('rpc/club_activity',owner,{p_club_id:clubId,p_before:cursor?.before??null,p_id:cursor?.id??null});expect(r.ok).toBe(true);const d=await r.json();expect(d.events.length).toBeLessThanOrEqual(50);for(const e of d.events){expect(seen.has(e.id)).toBe(false);seen.add(e.id);}cursor=d.next;}while(cursor);
 expect(seen.size).toBeGreaterThanOrEqual(65);
 expect((await (await rest('rpc/club_activity',owner,{p_club_id:foreignClubId})).json()).events).toEqual([]);
 await page.goto('/activity');await expect(page.getByRole('cell',{name:'删除当天数据',exact:true}).first()).toBeVisible();await expect(page.getByRole('main')).toContainText(users.admin.email);
 const foreign=(await auth('foreign')).access_token;expect((await request.get(`${baseURL}/api/activity`,{headers:{Cookie:`__Host-club_access=${foreign}`}})).status()).toBe(403);
 sql(`update public.club_memberships set status='revoked' where club_id='${clubId}' and user_id='${users.admin.id}';`);
 try{
  expect((await context.request.get(`${baseURL}/api/activity`)).status()).toBe(403);
  expect((await rest('rpc/club_delete_import_date',admin,deletion)).status).toBe(403);
  expect((await (await rest('rpc/club_activity',admin,{p_club_id:clubId})).json()).events).toEqual([]);
 }finally{sql(`update public.club_memberships set status='active' where club_id='${clubId}' and user_id='${users.admin.id}';`);}
});
