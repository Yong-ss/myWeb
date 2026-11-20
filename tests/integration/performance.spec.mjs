import {test,expect} from '@playwright/test';

import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {sql,auth,rest,clubId,baseURL,users,password} from './local.mjs';
import {handleMembers} from '../../apps/club/worker/members.ts';
test('bounded history over 80000 rows, RLS, cursor continuity and measured read baseline',async({page,context})=>{
 test.skip(process.env.CLUB_PERFORMANCE!=="1","Large fixture is opt-in: CLUB_PERFORMANCE=1");
 test.setTimeout(240000);
 const owner=(await auth('owner')).access_token;
 // Fixture writes are guarded by local.mjs and run ONLY inside the disposable stack.
 sql(`insert into public.club_players(id,club_id,display_name,match_name)
 select md5('perf-player-'||n)::uuid,'${clubId}','性能玩家'||n,'性能玩家'||n from generate_series(1,80)n;
 insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('perf-import-'||n)::uuid,'${clubId}','${users.owner.id}','{}',1,md5('perf-request-'||n)::uuid from generate_series(0,999)n;
 insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
 select md5('perf-snapshot-'||n)::uuid,'${clubId}',date '2040-01-01'+n,1,md5('perf-import-'||n)::uuid,true from generate_series(0,999)n;
 insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score,pathway)
 select '${clubId}',md5('perf-snapshot-'||d)::uuid,md5('perf-player-'||p)::uuid,'性能玩家'||p,d,case p when 1 then '占卜家' when 2 then '观众' end from generate_series(0,999)d cross join generate_series(1,80)p;
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
  for(let n=0;n<6;n++){calls=0;const start=performance.now();const r=await handler(new Request('https://local.invalid/api/members'),clubId,async (path,body)=>{calls++;return rest(path,owner,body);});expect(r.status).toBe(200);bytes=(await r.text()).length;samples.push(+(performance.now()-start).toFixed(1));}
  report.roster[name]={firstMs:samples[0],warmMs:samples.slice(1),calls,bytes};
 }
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);await page.goto('/account'); // the Super Admin lands on the platform centre
 for(const suffix of [`?player=${target}`,`?player=${target}&paged=1`]){const start=performance.now();const r=await context.request.get(`${baseURL}/api/members${suffix}`);expect(r.status()).toBe(200);report.history[suffix.includes('paged')?'paged':'legacy']={ms:+(performance.now()-start).toFixed(1),bytes:(await r.body()).length,timing:r.headers()['server-timing']};}
 report.plan=sql(`set local role authenticated;select set_config('request.jwt.claim.sub','${users.owner.id}',true);explain(analyze,buffers,format text) select id from public.club_snapshots where club_id='${clubId}' and is_current and snapshot_date<'2042-01-01' order by snapshot_date desc limit 100;`);

 const targetHttp='/api/members?player='+target+'&paged=1';
 const admin=(await auth('admin')).access_token;
 const endpoints={
  account:'/api/account', roster:'/api/members', score:'/api/members?trend=1', history:targetHttp,
  imports:'/api/import-context?date=2042-09-26&review_absences=1', activity:'/api/activity', events:'/api/events',
  highland:'/api/highland-events', dragon:'/api/dragon-events', team:'/api/team',
  fourWayHistory:'/api/player-events?player='+target, highlandHistory:'/api/player-highland?player='+target,
  dragonHistory:'/api/player-dragon?player='+target,
 };
 sql(`insert into public.club_players(id,club_id,display_name,match_name)
      select md5('perf-player-'||n)::uuid,'${clubId}','性能玩家'||n,'性能玩家'||n from generate_series(81,100)n;
      insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score)
      select '${clubId}',md5('perf-snapshot-'||d)::uuid,md5('perf-player-81')::uuid,'性能玩家81',d
      from generate_series(0,999,10)d;
      insert into public.club_events(id,club_id,event_type,event_date,total_score,created_by)
      select md5(kind||'-perf-event-'||d)::uuid,'${clubId}',kind,date '2040-01-01'+d,0,'${users.owner.id}'
      from unnest(array['four_way_league','highland_race','dragon_hunt']) kind cross join generate_series(0,999)d;
      insert into public.club_dragon_event_players(club_id,event_id,player_id,read_name)
      select '${clubId}',md5('dragon_hunt-perf-event-'||d)::uuid,'${target}','性能玩家1' from generate_series(0,999,2)d;
      analyze public.club_events; analyze public.club_dragon_event_players;
      analyze public.club_players; analyze public.club_snapshot_players;`);
 const sparse=sql("select md5('perf-player-81')::uuid");
 endpoints.sparseHistory='/api/members?player='+sparse+'&paged=1';
 report.current={fixture:{days:1000,syntheticIdentities:100,observations:80100,eventsByType:1000},sql:{},api:{},browser:{},scale:[]};
 const historyQuery=(player)=>`select public.club_history_page('${clubId}','${player}');`;
 const caseQueries={
  dense:historyQuery(target), sparse:historyQuery(sparse),
  dragon:`select public.club_player_dragon('${clubId}','${target}');`,
  dragonSparse:`select public.club_player_dragon('${clubId}','${sparse}');`,
  dragonNeverSeen:`select public.club_player_dragon('${clubId}',md5('perf-player-100')::uuid);`,
  account:`select public.club_my_access('${clubId}');`,
  context:'select public.club_my_context();',
  roster:`select public.club_roster_presence('${clubId}',md5('perf-snapshot-999')::uuid);`,
 };
 const measureSql=(query,prior='')=>{
  const plans=sql(`savepoint measurement;
    ${prior}
    set local role authenticated;
    set local request.jwt.claim.sub='${users.owner.id}';
    ${(`explain(analyze,buffers,format json) ${query}\n`).repeat(21)}
    rollback to savepoint measurement;`);
  const timings=[...plans.matchAll(/"Execution Time": ([\d.]+)/g)].map(match=>Number(match[1]));
  expect(timings).toHaveLength(21);
  return timings;
 };
 for(const [name,query] of Object.entries(caseQueries)) report.current.sql[name]=measureSql(query);
 // Re-run selected deployed definitions against the same fixture, then roll back the temporary replacement.
 const originalDefinition=(file,signature)=>{
  const source=readFileSync('supabase/migrations/'+file,'utf8');
  const start=source.indexOf('function '+signature+'(');
  const end=source.indexOf('$$;',source.indexOf('as $$',start)+5);
  if(start<0||end<0)throw Error('Could not locate '+signature);
  return 'create or replace '+source.slice(start,end+3);
 };
 const oldAttendance=originalDefinition('20261106120000_club_dragon_hunt.sql','club_private.event_attendance');
 const oldContext=originalDefinition('20261101163647_club_my_context.sql','public.club_my_context');
 report.current.sqlBaseline={};
 for(const name of ['dragon','dragonSparse','dragonNeverSeen','context']){
  report.current.sqlBaseline[name]=measureSql(caseQueries[name],name==='context'?oldContext:oldAttendance);
 }
 mkdirSync('.test-artifacts',{recursive:true});writeFileSync('.test-artifacts/performance-sql.json',JSON.stringify(report.current.sql,null,2));
 const read=async(path,token)=>{
  const start=performance.now();
  const response=await context.request.get(baseURL+path,{headers:{Cookie:'__Host-club_access='+token}});
  const bytes=(await response.body()).length;
  expect(response.status(),path).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return {ms:+(performance.now()-start).toFixed(1),bytes,timing:response.headers()['server-timing']};
 };
 // The first request per endpoint is retained separately from the following 20 warm observations.
 for(const [name,path] of Object.entries(endpoints)){
  const observations=[];
  for(let trial=0;trial<21;trial++) observations.push(await read(path,owner));
  report.current.api[name]=observations;
 }
 report.current.concurrent=[];
 for(let trial=0;trial<5;trial++)report.current.concurrent.push(await Promise.all([read(targetHttp,owner),read(targetHttp,admin)]));
 for(const size of [1000,10000]){
  const scaleClub=sql(`select md5('perf-scale-${size}')::uuid;`);
  sql(`insert into public.club_clubs(id,name) values('${scaleClub}','性能测试 ${size}');
    insert into public.club_memberships(club_id,user_id,role) values('${scaleClub}','${users.owner.id}','owner');
    insert into public.club_players(club_id,display_name,match_name)
      select '${scaleClub}','性能玩家'||n,'性能玩家'||n from generate_series(1,${size})n;
    insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
      values(md5('perf-scale-import-${size}')::uuid,'${scaleClub}','${users.owner.id}','{}',1,gen_random_uuid());
    insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster)
      values(gen_random_uuid(),'${scaleClub}',date '2040-01-01',1,md5('perf-scale-import-${size}')::uuid,true);`);
  const start=performance.now();
  const result=await context.request.get(`${baseURL}/api/members?club=${scaleClub}`,{headers:{Cookie:'__Host-club_access='+owner}});
  expect(result.status()).toBe(413);
  report.current.scale.push({identities:size,status:result.status(),ms:+(performance.now()-start).toFixed(1),timing:result.headers()['server-timing']});
 }
 for(const [name,path] of Object.entries({dashboard:'/account',members:'/members',profile:'/players?id='+target,events:'/events',highland:'/highland',dragon:'/dragon',activity:'/activity',imports:'/import',team:'/team'})){
  const targetURL=new URL(path,baseURL);
  targetURL.searchParams.set('club',clubId);
  const requests=[];
  const record=request=>{const url=new URL(request.url());if(url.origin===baseURL)requests.push(url.pathname);};
  page.on('request',record);
  await page.goto(targetURL.href);
  await expect(page.getByRole('button',{name:'退出登录'})).toBeEnabled();
  // Let the page's initial parallel work and Next's visible-link prefetch settle.
  await page.waitForLoadState('networkidle');
  report.current.browser[name]={api:requests.filter(path=>path.startsWith('/api/')),static:requests.filter(path=>!path.startsWith('/api/')).length,
   assets:await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>/\/(pathways?|_next\/static)\//.test(new URL(entry.name).pathname)).map(entry=>({path:new URL(entry.name).pathname,bytes:entry.transferSize})))};
  page.off('request',record);
 }


 mkdirSync('.test-artifacts',{recursive:true});writeFileSync('.test-artifacts/performance.json',JSON.stringify(report,null,2));
});



