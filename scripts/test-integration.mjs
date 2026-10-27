import '../tests/runtime-env.mjs';
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, unlinkSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { project, runtime, workdir, apiURL, users, password, clubId, foreignClubId, playerId, foreignPlayerId, cli, sql, command, assertLocalDocker, localFetch, redact } from '../tests/integration/local.mjs';

mkdirSync(runtime,{recursive:true});
const lock=join(runtime,'run.lock');
const fd=openSync(lock,'wx'); closeSync(fd);
const diagnostics=resolve('.test-artifacts/integration-services.log');
if(existsSync(diagnostics)) unlinkSync(diagnostics);
let started=false;
let successful=false;
try {
  assertLocalDocker();
  console.log('Integration: building current Club assets.');
  const manager=process.env.npm_execpath;
  if(!manager) throw Error('Run integration tests through pnpm test:integration');
  const buildArgs=['--filter','@squirrelapi/club','build'];
  command(/\.(c?js|mjs)$/.test(manager)?process.execPath:manager,/\.(c?js|mjs)$/.test(manager)?[manager,...buildArgs]:buildArgs,{timeout:180000});
  mkdirSync(join(workdir,'supabase/migrations'),{recursive:true});
  copyFileSync('tests/integration/supabase/config.toml',join(workdir,'supabase/config.toml'));
  // Discard only this dedicated test stack; never --all, --linked or --db-url.
  cli(['stop','--no-backup']);
  for(const file of readdirSync(join(workdir,'supabase/migrations'))) {
    if(!/^\d+_.+\.sql$/.test(file)) throw Error('Unexpected file in generated test migrations');
    unlinkSync(join(workdir,'supabase/migrations',file));
  }
  console.log('Integration: starting isolated Supabase Auth/PostgreSQL/REST.');
  started=true;
  cli(['start','--exclude','realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  const status=JSON.parse(cli(['status','-o','json']));
  if(status.API_URL!==apiURL || new URL(status.DB_URL).hostname!=='127.0.0.1' || new URL(status.DB_URL).port!=='56322') throw Error('Unexpected Supabase endpoint');
  const anonKey=status.PUBLISHABLE_KEY??status.ANON_KEY;
  // Use the real local Auth admin API, never direct auth.users inserts.
  for(const user of Object.values(users)) {
    const r=await localFetch('/auth/v1/admin/users',{method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:`Bearer ${status.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({...user,password,email_confirm:true})});
    if(!r.ok) throw Error(`Local test user creation failed: ${r.status} ${await r.text()}`);
    if((await r.json()).id!==user.id) throw Error('Auth did not preserve the synthetic user id');
  }
  sql(`create schema integration_test; create table integration_test.guard(id text primary key); insert into integration_test.guard values('${project}');`,true);
  for(const file of readdirSync('supabase/migrations').filter(f=>/^\d+_.+\.sql$/.test(f)).sort()) copyFileSync(join('supabase/migrations',file),join(workdir,'supabase/migrations',file));
  cli(['migration','up','--local']);
  sql(`insert into public.club_clubs(id,name) values('${foreignClubId}','Integration club B');
    insert into public.club_memberships(club_id,user_id,role) values('${clubId}','${users.admin.id}','admin'),('${foreignClubId}','${users.foreign.id}','owner');
    insert into public.club_players(id,club_id,display_name,match_name) values('${playerId}','${clubId}','集成测试玩家','集成测试玩家'),('${foreignPlayerId}','${foreignClubId}','其他俱乐部玩家','其他俱乐部玩家');
    notify pgrst, 'reload schema';`);
  writeFileSync(join(runtime,'state.json'),JSON.stringify({project,API_URL:apiURL,anonKey}),{mode:0o600});
  const preflight=await localFetch('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:users.owner.email,password})});
  if(!preflight.ok) throw Error(`Local Auth preflight failed: ${preflight.status} ${await preflight.text()}`);
  const vars={SUPABASE_URL:apiURL,SUPABASE_PUBLISHABLE_KEY:anonKey,CLUB_ID:clubId};
  writeFileSync(join(runtime,'wrangler.jsonc'),JSON.stringify({name:'squirrelapi-club-local-integration',main:resolve('apps/club/worker/index.ts'),compatibility_date:'2026-10-19',workers_dev:false,vars,assets:{binding:'ASSETS',directory:resolve('apps/club/out'),run_worker_first:['/api/*'],not_found_handling:'404-page'}}));
  writeFileSync(join(runtime,'.dev.vars'),Object.entries(vars).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n'));
  const require=createRequire(import.meta.url);
  const playwright=resolve(require.resolve('@playwright/test/package.json'),'../cli.js');
  const report=command(process.execPath,[playwright,'test','--config','playwright.integration.config.mjs'],{timeout:300000});
  successful=true;
  console.log(`Integration: ${report.match(/\d+ passed[^\r\n]*/)?.[0]??'passed'}; real Auth, HTTPS Worker, REST and database.`);
} catch(error) {
  console.error(redact(error.message)); process.exitCode=1;
  if(started) {
    try {
      assertLocalDocker();
      mkdirSync(resolve('.test-artifacts'),{recursive:true});
      const logs=['db','auth','rest'].map(service=>{
        const r=spawnSync('docker',['logs','--tail','60',`supabase_${service}_${project}`],{encoding:'utf8',timeout:10000});
        return `${service}:\n${redact((r.stdout??'')+(r.stderr??''))}`;
      }).join('\n');
      writeFileSync(diagnostics,logs);
    } catch { console.error('Local service diagnostics unavailable.'); }
  }
} finally {
  if(started) {
    try { cli(['stop','--no-backup']); } catch(error) { console.error(redact(error.message)); process.exitCode=1; }
  }
  for(const file of ['state.json','.dev.vars']) if(existsSync(join(runtime,file))) unlinkSync(join(runtime,file));
  unlinkSync(lock);
  if(!successful) console.error('Integration failed; inspect failure-only Playwright artifacts. The dedicated local stack was stopped.');
}
