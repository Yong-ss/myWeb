import {test,expect} from '@playwright/test';

import {writeFileSync,mkdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {sql,auth,rest,clubId,baseURL,users,password} from './local.mjs';
import {handleMembers} from '../../apps/club/worker/members.ts';
test('bounded history over 80000 rows, RLS, cursor continuity and measured read baseline',async({page,context})=>{
 test.skip(process.env.CLUB_PERFORMANCE!=="1","Large fixture is opt-in: CLUB_PERFORMANCE=1");
 test.setTimeout(120000);
 const owner=(await auth('owner')).access_token;
 // Fixture writes are guarded by local.mjs and run ONLY inside the disposable stack.
 sql(`insert into public.club_players(id,club_id,display_name,match_name)
 select md5('perf-player-'||n)::uuid,'${clubId}','性能玩家'||n,'性能玩家'||n from generate_series(1,80)n;
 insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('perf-import-'||n)::uuid,'${clubId}','${users.owner.id}','{}',1,md5('perf-request-'||n)::uuid from generate_series(0,999)n;
 insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
 select md5('perf-snapshot-'||n)::uuid,'${clubId}',date '2040-01-01'+n,1,md5('perf-import-'||n)::uuid,true from generate_series(0,999)n;
 insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score)
 select '${clubId}',md5('perf-snapshot-'||d)::uuid,md5('perf-player-'||p)::uuid,'性能玩家'||p,d from generate_series(0,999)d cross join generate_series(1,80)p;
 analyze public.club_snapshots;analyze public.club_snapshot_players;`);
 const target=sql("select md5('perf-player-1')::uuid");
 const page1=await rest('rpc/club_history_page',owner,{p_club:clubId,p_player:target});expect(page1.ok,await page1.clone().text()).toBe(true);
 const first=await page1.json();expect(first.days).toHaveLength(100);expect(first.next).toBeTruthy();
 const second=await (await rest('rpc/club_history_page',owner,{p_club:clubId,p_player:target,p_before:first.next})).json();
 expect(second.days.at(-1).snapshot_date<first.days[0].snapshot_date).toBe(true);expect(first.previous.extraordinary_score).toBe(899);
 const foreign=(await auth('foreign')).access_token;expect(await (await rest('rpc/club_history_page',foreign,{p_club:clubId,p_player:target})).json()).toBe(null);
 // Compare identical input/REST network against the pre-optimization HEAD implementation.

 let oldSource=execFileSync('git',['show','c56d6d3c71932dd615cb6e7a9e232410c2b03732:apps/club/worker/members.ts'],{encoding:'utf8'});
 for(const [from,to] of [['../src/lib/import.ts','apps/club/src/domain/member.ts'],['../src/lib/presence.ts','apps/club/src/domain/presence.ts'],['./player-history.ts','apps/club/worker/player-history.ts']])oldSource=oldSource.replace(from,pathToFileURL(resolve(to)).href);
 const baseline=(await Function('url','return import(url)')('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(oldSource)).toString('base64'))).handleMembers;
 const report={fixture:{days:1000,players:80,rows:80000},roster:{},history:{},plan:''};
 for(const [name,handler] of [['before',baseline],['after',handleMembers]]){
  const samples=[];let bytes=0,calls=0;
  for(let n=0;n<6;n++){calls=0;const start=performance.now();const r=await handler(new Request('https://local.invalid/api/members'),clubId,async path=>{calls++;return rest(path,owner);});expect(r.status).toBe(200);bytes=(await r.text()).length;samples.push(+(performance.now()-start).toFixed(1));}
  report.roster[name]={firstMs:samples[0],warmMs:samples.slice(1),calls,bytes};
 }
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/account$/);
 for(const suffix of [`?player=${target}`,`?player=${target}&paged=1`]){const start=performance.now();const r=await context.request.get(`${baseURL}/api/members${suffix}`);expect(r.status()).toBe(200);report.history[suffix.includes('paged')?'paged':'legacy']={ms:+(performance.now()-start).toFixed(1),bytes:(await r.body()).length,timing:r.headers()['server-timing']};}
 report.plan=sql(`set local role authenticated;select set_config('request.jwt.claim.sub','${users.owner.id}',true);explain(analyze,buffers,format text) select id from public.club_snapshots where club_id='${clubId}' and is_current and snapshot_date<'2042-01-01' order by snapshot_date desc limit 100;`);
 mkdirSync('.test-artifacts',{recursive:true});writeFileSync('.test-artifacts/performance.json',JSON.stringify(report,null,2));
});



