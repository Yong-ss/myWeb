import '../runtime-env.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const project = 'squirrelapi-club-integration';
export const workdir = resolve('.test-runtime/integration/project');
export const runtime = resolve('.test-runtime/integration');
export const baseURL = 'https://127.0.0.1:8792';
export const apiURL = 'http://127.0.0.1:56321';
export const clubId = 'ce0c7103-1cdf-4b08-8619-f71d4915f598';
export const foreignClubId = '00000000-0000-4000-8000-000000000201';
export const playerId = '00000000-0000-4000-8000-000000000301';
export const foreignPlayerId = '00000000-0000-4000-8000-000000000302';
export const password = 'Local-Club-Only-2026!';
export const users = {
  owner:{ id:'d0ddb226-a10a-471c-be4b-d5e5153bd313', email:'owner@club.test' },
  admin:{ id:'00000000-0000-4000-8000-000000000101', email:'admin@club.test' },
  outsider:{ id:'00000000-0000-4000-8000-000000000102', email:'outsider@club.test' },
  foreign:{ id:'00000000-0000-4000-8000-000000000103', email:'foreign@club.test' },
};
export function redact(value) { return String(value).replace(/eyJ[A-Za-z0-9_.-]+/g,'[LOCAL JWT]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,'[LOCAL KEY]'); }
export const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PG|CLOUDFLARE_API|DATABASE_URL)/i.test(key) && (!key.toUpperCase().startsWith('SUPABASE_') || ['SUPABASE_HOME','SUPABASE_BIN'].includes(key))));
export function command(executable,args,options={}) {
  const r=spawnSync(executable,args,{encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024,env:childEnv,...options});
  if(r.error || r.status!==0) throw Error(redact(`${executable.split(/[\\/]/).pop()} failed: ${r.error?.message??''}\n${r.stdout??''}\n${r.stderr??''}`));
  return r.stdout;
}
export function assertLocalDocker() {
  if(process.env.DOCKER_HOST && !/^(npipe:|unix:)/.test(process.env.DOCKER_HOST)) throw Error('Remote Docker hosts are forbidden for integration tests');
  const endpoint=command('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']).trim();
  if(!/^(npipe:|unix:)/.test(endpoint)) throw Error('Integration tests require a local Docker context');
}
export function assertTestProject() {
  if(!/^project_id\s*=\s*"squirrelapi-club-integration"/m.test(readFileSync(resolve(workdir,'supabase/config.toml'),'utf8'))) throw Error('Wrong local test project');
  if(existsSync(resolve(workdir,'supabase/.temp/project-ref'))) throw Error('Linked Supabase projects are forbidden');
}
export function cli(args) {
  assertLocalDocker(); assertTestProject();
  if(!['start','stop','status','migration'].includes(args[0]) || (args[0]==='migration' && args[1]!=='up')) throw Error('Unsupported integration CLI command');
  if(args.some(arg=>/^--(linked|db-url|project-ref|all|workdir|project-id)(=|$)/.test(arg)) || (args[0]==='migration'&&!args.includes('--local'))) throw Error('Remote or alternate Supabase targets are forbidden');
  const executable=process.env.SUPABASE_BIN ?? (process.platform==='win32' ? 'C:/Users/sungs/OneDrive/Desktop/Global_Env/tools/fyp-testing/node_modules/@supabase/cli-windows-x64/bin/supabase.exe' : 'supabase');
  return command(executable,[...args,'--workdir',workdir,'--yes']);
}
export function state() {
  const value=JSON.parse(readFileSync(resolve(runtime,'state.json'),'utf8'));
  if(value.API_URL!==apiURL || value.project!==project) throw Error('Non-local integration state rejected');
  return value;
}
export async function localFetch(path,options={}) {
  const target=new URL(path,apiURL);
  if(target.origin!==apiURL) throw Error('Remote Supabase requests are forbidden');
  return fetch(target,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
}
export function sql(query,initial=false) {
  assertLocalDocker(); assertTestProject();
  const labels=JSON.parse(command('docker',['inspect',`supabase_db_${project}`,'--format','{{json .Config.Labels}}']));
  if(labels['com.supabase.cli.project']!==project) throw Error('Unexpected PostgreSQL container');
  const guard=initial ? '' : `do $$ begin if not exists(select 1 from integration_test.guard where id='${project}') then raise exception 'Missing integration test marker'; end if; end $$;`;
  return command('docker',['exec','-i',`supabase_db_${project}`,'psql','--no-psqlrc','--host=/var/run/postgresql','--username=postgres','--dbname=postgres','-Atq','--set=ON_ERROR_STOP=1'],{input:`begin;\n${guard}\n${query}\ncommit;`}).trim();
}
export async function rest(path,token,body,method) {
  const r=await localFetch(`/rest/v1/${path}`,{method:method??(body===undefined?'GET':'POST'),headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return r;
}
export async function auth(role) {
  const r=await localFetch('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:state().anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:users[role].email,password})});
  if(!r.ok) throw Error(`Local Auth login failed: ${r.status} ${await r.text()}`);
  return r.json();
}
