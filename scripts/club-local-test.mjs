import '../tests/runtime-env.mjs';
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, unlinkSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { project, runtime, workdir, apiURL, baseURL, users, password, clubId, cli, sql, command, assertLocalDocker, localFetch, redact } from '../tests/integration/local.mjs';

// Manual testing on the same isolated stack as pnpm test:integration: local Supabase in Docker (project
// squirrelapi-club-integration, ports 563xx), synthetic accounts, every migration, and the current Club build served by
// the Club Worker at https://127.0.0.1:8792. Never a production URL, key or database. Data is discarded on stop.
// Usage: node scripts/club-local-test.mjs        (start; Ctrl+C stops and discards everything)
//        node scripts/club-local-test.mjs stop   (stop a stack left running)
const lock = join(runtime, 'run.lock');
const stop = () => { try { cli(['stop', '--no-backup']); } catch (error) { console.error(redact(error.message)); }
  for (const file of ['state.json', '.dev.vars', 'run.lock']) if (existsSync(join(runtime, file))) unlinkSync(join(runtime, file)); };
if (process.argv[2] === 'stop') { stop(); console.log('Local test stack stopped; its data is discarded.'); process.exit(0); }

mkdirSync(runtime, { recursive: true });
closeSync(openSync(lock, 'wx')); // one stack at a time (shared with pnpm test:integration)
assertLocalDocker();
console.log('Building the current Club assets…');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
command(pnpm, ['--filter', '@squirrelapi/club', 'build'], { timeout: 300000, shell: process.platform === 'win32' });
mkdirSync(join(workdir, 'supabase/migrations'), { recursive: true });
copyFileSync('tests/integration/supabase/config.toml', join(workdir, 'supabase/config.toml'));
mkdirSync(join(workdir, 'supabase/templates'), { recursive: true });
for (const file of ['invite.html', 'reset-password.html']) copyFileSync(join('docs/email-templates', file), join(workdir, 'supabase/templates', file));
for (const file of readdirSync(join(workdir, 'supabase/migrations'))) unlinkSync(join(workdir, 'supabase/migrations', file));
cli(['stop', '--no-backup']);
console.log('Starting the isolated local Supabase (Auth, PostgreSQL, REST)…');
cli(['start', '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
const status = JSON.parse(cli(['status', '-o', 'json']));
if (status.API_URL !== apiURL || new URL(status.DB_URL).hostname !== '127.0.0.1') throw Error('Unexpected Supabase endpoint');
const anonKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
for (const user of Object.values(users)) {
  const r = await localFetch('/auth/v1/admin/users', { method: 'POST', headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...user, password, email_confirm: true }) });
  if (!r.ok) throw Error(`Local test user creation failed: ${r.status}`);
}
sql(`create schema integration_test; create table integration_test.guard(id text primary key); insert into integration_test.guard values('${project}');`, true);
for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort()) copyFileSync(join('supabase/migrations', file), join(workdir, 'supabase/migrations', file));
cli(['migration', 'up', '--local']);
// The admin account manages the test club (the owner account is also the Super Admin and starts in the platform centre).
sql(`update public.club_clubs set name='本地测试俱乐部' where id='${clubId}';
  insert into public.club_memberships(club_id,user_id,role) values('${clubId}','${users.admin.id}','admin');
  notify pgrst, 'reload schema';`);
writeFileSync(join(runtime, 'state.json'), JSON.stringify({ project, API_URL: apiURL, anonKey, serviceKey: status.SERVICE_ROLE_KEY }), { mode: 0o600 });
const vars = { SUPABASE_URL: apiURL, SUPABASE_PUBLISHABLE_KEY: anonKey, CLUB_ID: clubId };
writeFileSync(join(runtime, 'wrangler.jsonc'), JSON.stringify({ name: 'squirrelapi-club-local-integration', main: resolve('apps/club/worker/index.ts'), compatibility_date: '2026-10-19', workers_dev: false, vars, assets: { binding: 'ASSETS', directory: resolve('apps/club/out'), run_worker_first: ['/api/*'], not_found_handling: '404-page' } }));
writeFileSync(join(runtime, '.dev.vars'), Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n'));
const worker = spawn(process.execPath, ['tests/integration/worker.mjs'], { stdio: 'inherit' });
const shutdown = () => { worker.kill(); stop(); process.exit(0); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
worker.on('exit', () => { stop(); process.exit(1); });
console.log(`Local Club test site: ${baseURL}/login?club=${clubId} (admin ${users.admin.email}). Ctrl+C stops and discards the data.`);
