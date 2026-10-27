import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function scopeFor(files, full = false) {
  const result = { web:full, club:full, db:full, e2e:full ? 'all' : 'none' };
  for (const file of files) {
    if (/^(README\.md|AGENTS\.md|docs\/)/.test(file)) continue;
    if (file.startsWith('apps/web/')) result.web = true;
    else if (file.startsWith('apps/club/')) {
      result.club = true;
      const kind = /import|prompt/.test(file) ? 'import' : /auth\.test|\/(login|account)\//.test(file) ? 'auth' : 'all';
      result.e2e = result.e2e === 'none' || result.e2e === kind ? kind : 'all';
      if (/worker\/|src\/lib\//.test(file)) result.db = true;
    } else if (file.startsWith('supabase/')) { result.db = true; result.club = true; result.e2e = 'all'; }
    else Object.assign(result, { web:true, club:true, db:true, e2e:'all' });
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--run');
  const base = process.env.CI_BASE_SHA;
  const full = process.argv.includes('--full') || process.env.FULL_REGRESSION === 'true' || (!run && (!base || !/^[a-f0-9]{40}$/i.test(base) || /^0+$/.test(base)));
  let files = [];
  let scope;
  try {
    if (!full) {
      files = execFileSync('git', ['diff','--name-only',...(base ? [base,'HEAD'] : ['HEAD']),'--'], { encoding:'utf8' }).trim().split('\n').filter(Boolean);
      if (run) files.push(...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean));
    }
    scope = scopeFor(files, full);
  }
  catch { scope = scopeFor([], true); }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(scope).map(([key,value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(scope));
  if (run) {
    await import('../tests/runtime-env.mjs');
    const commands = [['node',['--test','tests/ci-scope.test.mjs']]];
    if (scope.web) for (const task of ['lint','typecheck']) commands.push(['pnpm',['--filter','@squirrelapi/web',task]]);
    if (scope.web) commands.push(['node',['--test','apps/web/worker/auth.test.mjs']],['pnpm',['--filter','@squirrelapi/web','build']]);
    if (scope.club) commands.push(['pnpm',['club:check']]);
    if (scope.db) commands.push(['pnpm',['test:db']]);
    if (scope.e2e !== 'none') commands.push(['pnpm',['test:e2e',...(scope.e2e === 'all' ? [] : [`${scope.e2e}.spec.mjs`])]]);
    for (const [command,args] of commands) {
      const result=spawnSync(command === 'node' ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',args,{stdio:'inherit',shell:command==='pnpm' && process.platform==='win32'});
      if (result.error || result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
