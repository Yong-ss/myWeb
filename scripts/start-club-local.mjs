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
async function free(port,purpose) {
  await new Promise((accept,reject)=>{
    const server=net.createServer();
    server.once('error',()=>reject(Error(`Port ${port} (${purpose}) is already in use. An earlier preview is probably still running: close that window or press Ctrl+C in it, then start again.`)));
    server.listen(port,'127.0.0.1',()=>server.close(accept));
  });
}
const listening=port=>new Promise(done=>{const socket=net.connect(port,'127.0.0.1',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));});
// Open the browser only once both servers answer, so the first page load never shows a connection error.
// Next.js allows one `next dev` per app folder (it writes .next/dev/lock). If one is already running, e.g. a
// VS Code task on 3001, reuse it rather than failing; the Worker forwards page requests to whichever it is.
async function runningNextDev() {
  try {
    const lock=JSON.parse(readFileSync(resolve(app,'.next/dev/lock'),'utf8'));
    if(lock.port&&await listening(lock.port))return {port:lock.port,pid:lock.pid};
  } catch {}
  return null;
}
async function openWhenReady(url,nextPort) {
  const deadline=Date.now()+180000;
  while(!stopping&&Date.now()<deadline){
    if(await listening(8788)&&await fetch(`http://127.0.0.1:${nextPort}/`).then(r=>r.ok,()=>false)){
      console.log(`\nREADY: ${url}\n`);
      if(process.platform==='win32')spawn('cmd',['/c','start','',url],{stdio:'ignore',windowsHide:true,detached:true}).unref();
      return;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!stopping)console.log(`\nStill starting. Open ${url} by hand once the logs settle.\n`);
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
  const existing=await runningNextDev();
  const nextPort=existing?.port??3002;
  if(!existing)await free(3002,'Next.js');
  await free(8788,'local Worker');await free(9233,'Worker inspector');
  mkdirSync(runtime,{recursive:true});
  writeFileSync(resolve(runtime,'wrangler.json'),JSON.stringify({name:'squirrelapi-club-local-ui',main:resolve(root,'scripts/club-local-worker.ts'),compatibility_date:'2026-10-19',workers_dev:false,vars:{...vars,NEXT_DEV_HOST:`127.0.0.1:${nextPort}`}}));
  const url='https://127.0.0.1:8788/account';
  console.log(`\nLOCAL UI: ${url}`);
  console.log(`Always use this address. Port ${nextPort} alone has no /api, so it shows "暂时无法读取账户".`);
  if(existing)console.log(`Reusing the Next.js dev server already running on ${nextPort} (PID ${existing.pid}); it keeps running after Ctrl+C here.`);
  console.log('DATA: existing PRODUCTION Supabase. Saving imports changes real data.');
  console.log('Sign in with your usual Club account. Local login is separate.');
  console.log('Source edits update locally; refresh the page if needed. Nothing is pushed or deployed.');
  console.log('Local HTTPS uses a self-signed certificate. Accept it only for 127.0.0.1.');
  console.log('Press Ctrl+C to stop both local servers.\n');
  if(!existing)start(next,['dev','--hostname','127.0.0.1','--port','3002'],app);
  start(wrangler,['dev','--local','--config',resolve(runtime,'wrangler.json'),'--ip','127.0.0.1','--port','8788','--inspector-port','9233','--local-protocol','https'],runtime);
  process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
  void openWhenReady(url,nextPort);
} catch(error) {console.error(`Cannot start Club: ${error.message}`);stop(1);}
