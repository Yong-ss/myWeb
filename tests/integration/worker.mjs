import '../runtime-env.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { runtime, state, childEnv } from './local.mjs';

state(); // Fail before launching if the setup did not verify the local stack.
const require=createRequire(resolve('apps/club/package.json'));
const wrangler=resolve(require.resolve('wrangler/package.json'),'../bin/wrangler.js');
const child=spawn(process.execPath,[wrangler,'dev','--local','--config',resolve(runtime,'wrangler.jsonc'),'--ip','127.0.0.1','--port','8792','--inspector-port','9232','--local-protocol','https','--log-level','warn'],{cwd:runtime,env:{...childEnv,CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
