import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Tests run for anything that can break them; deploys only for files that change a shipped app.
export function scopeFor(files, full = false) {
  const result = { web:full, club:full, db:full, e2e:full ? 'all' : 'none', integration:full, deploy_web:full, deploy_club:full };
  const everything = { web:true, club:true, db:true, e2e:'all', integration:true };
  for (const file of files) {
    if (/\.md$/i.test(file) || file.startsWith('docs/')) continue;
    const testOnly = /\.test\.mjs$/.test(file);
    if (file.startsWith('apps/web/')) Object.assign(result, { web:true }, testOnly ? {} : { deploy_web:true });
    else if (file.startsWith('apps/club/')) {
      Object.assign(result, { club:true, e2e:'all' }, testOnly ? {} : { deploy_club:true });
      // Worker code and the pure .ts modules it imports (shared contracts, feature rules) can change what reaches the database.
      if (/worker\/|src\/(lib|domain)\/|src\/features\/[^/]+\/[^/]+\.ts$/.test(file)) result.db = true;
      if (!/(\.css$|\/src\/app\/(page|not-found|layout)\.tsx$)/.test(file)) result.integration = true;
    }
    // Migrations are applied manually; the Worker bundle does not change.
    else if (file.startsWith('supabase/')) Object.assign(result, { db:true, club:true, e2e:'all', integration:true });
    else if (/^(tests|scripts|\.github)\/|^playwright[\w.]*\.mjs$/.test(file)) Object.assign(result, everything);
    // Dependencies, workspace config and unknown paths can change either bundle.
    else Object.assign(result, everything, { deploy_web:true, deploy_club:true });
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--run');
  let base = process.env.CI_BASE_SHA;
  // Locally compare against the pushed branch so committed-but-unpushed work is included.
  if (run && !base) try { base = execFileSync('git',['merge-base','@{upstream}','HEAD'],{encoding:'utf8'}).trim(); } catch {}
  const full = process.argv.includes('--full') || process.env.FULL_REGRESSION === 'true' || (!run && (!base || !/^[a-f0-9]{40}$/i.test(base) || /^0+$/.test(base)));
  let files = [];
  let scope;
  try {
    if (!full) {
      files = execFileSync('git', ['diff','--name-only',...(run ? [base || 'HEAD'] : [base,'HEAD']),'--'], { encoding:'utf8' }).trim().split('\n').filter(Boolean);
      if (run) files.push(...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean));
    }
    scope = scopeFor(files, full);
  }
  catch { scope = scopeFor([], true); }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(scope).map(([key,value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(scope));
  if (run) {
    await import('../tests/runtime-env.mjs');
    const commands = [['pnpm',['test:unit']]];
    if (scope.web) for (const task of ['lint','typecheck']) commands.push(['pnpm',['--filter','@squirrelapi/web',task]]);
    if (scope.web) commands.push(['node',['--test','apps/web/worker/auth.test.mjs']],['pnpm',['--filter','@squirrelapi/web','build']]);
    if (scope.club) commands.push(['pnpm',['club:check']]);
    if (scope.db) commands.push(['pnpm',['test:db']]);
    if (scope.e2e !== 'none') commands.push(['pnpm',['test:e2e']]);
    if (scope.integration) commands.push(['pnpm',['test:integration']]);
    for (const [command,args] of commands) {
      const result=spawnSync(command === 'node' ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',args,{stdio:'inherit',shell:command==='pnpm' && process.platform==='win32'});
      if (result.error || result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
