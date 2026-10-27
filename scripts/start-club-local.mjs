import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const root=resolve(import.meta.dirname,'..');
const app=resolve(root,'apps/club');
const runtime=resolve(root,'.test-runtime/club-local-ui');
const children=[];
let stopping=false;
function stop(code=0) {
  if(stopping)return; stopping=true;
  for(const child of children) {
    if(child.exitCode!==null)continue;
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else child.kill('SIGTERM');
  }
  process.exitCode=code;
}
async function free(port) {
  await new Promise((accept,reject)=>{
    const server=net.createServer();
    server.once('error',()=>reject(Error(`Port ${port} is already in use. Close the previous local preview first.`)));
    server.listen(port,'127.0.0.1',()=>server.close(accept));
  });
}
function start(cli,args,cwd) {
  const child=spawn(process.execPath,[cli,...args],{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'}});
  children.push(child);
  child.once('error',error=>{console.error(error.message);stop(1);});
  child.once('exit',code=>{if(!stopping)stop(code??1);});
}
try {
  const require=createRequire(resolve(app,'package.json'));
  const next=resolve(require.resolve('next/package.json'),'../dist/bin/next');
  const wrangler=resolve(require.resolve('wrangler/package.json'),'../bin/wrangler.js');
  const vars=JSON.parse(readFileSync(resolve(app,'wrangler.jsonc'),'utf8')).vars;
  if(vars.SUPABASE_URL!=='https://lnwifbsjfwchshtxyzcu.supabase.co'||!vars.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')||!vars.CLUB_ID)throw Error('Expected the existing Club production Supabase configuration.');
  await free(3002);await free(8788);await free(9233);
  mkdirSync(runtime,{recursive:true});
  writeFileSync(resolve(runtime,'wrangler.json'),JSON.stringify({name:'squirrelapi-club-local-ui',main:resolve(root,'scripts/club-local-worker.ts'),compatibility_date:'2026-10-19',workers_dev:false,vars}));
  console.log('\nLOCAL UI: https://127.0.0.1:8788/import');
  console.log('DATA: existing PRODUCTION Supabase. Saving imports changes real data.');
  console.log('Sign in with your usual Club account. Local login is separate.');
  console.log('Source edits update locally; refresh the page if needed. Nothing is pushed or deployed.');
  console.log('Local HTTPS uses a self-signed certificate. Accept it only for 127.0.0.1.');
  console.log('Press Ctrl+C to stop both local servers.\n');
  start(next,['dev','--hostname','127.0.0.1','--port','3002'],app);
  start(wrangler,['dev','--local','--config',resolve(runtime,'wrangler.json'),'--ip','127.0.0.1','--port','8788','--inspector-port','9233','--local-protocol','https'],runtime);
  process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
} catch(error) {console.error(`Cannot start Club: ${error.message}`);stop(1);}
