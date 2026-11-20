import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Deployment-order check: the already deployed Worker runs its own real integration suite against the database with
// new migrations applied. This is the state between "migrate" and "deploy", after a failed deploy or a Worker rollback.
// Local disposable Supabase only (same runner as test:integration).
// Usage: pnpm test:compat [ref] [state ...]   states: all (default)
// ref must be the commit the production Club Worker was actually deployed from (check the last successful main run
// that deployed Club, see docs/TESTING.md); origin/main is only the default and may contain undeployed commits.
const [ref = 'origin/main', ...only] = process.argv.slice(2);
// Pending migrations, in order. Each state applies a prefix of this list (one migration: one state).
// History: Club permissions V1 (7 migrations, 2026-11-03) were checked here in states A, A-C, A-E and all;
// Four-Way League 20261104140000_club_events.sql (2026-11-04) and Highland Race 20261105090000_club_highland.sql
// (2026-11-05) in state all.
const pending = ['20261120012000_club_read_efficiency.sql'];
const states = { all: { files: 1 } };
const superseded = [];
// Extend harness deadlines; assertions stay unchanged.
const edits = () => ({
  'playwright.integration.config.mjs': [['globalTimeout:480000', 'globalTimeout:900000']],
  'scripts/test-integration.mjs': [['{timeout:540000}', '{timeout:960000}']],
});
const run = only.length ? only : Object.keys(states);
for (const name of run) if (!states[name]) throw Error(`Unknown compat state ${name}; use ${Object.keys(states).join(', ')}`);
const dir = resolve('.test-runtime/compat');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const clean = () => {
  if (realpathSync(dir) !== join(realpathSync('.'), '.test-runtime', 'compat')) throw Error('Unexpected compatibility worktree path');
  rmSync(dir, { recursive: true, force: true });
  git('worktree', 'prune');
};
if (existsSync(dir)) clean();
git('worktree', 'add', '--detach', dir, ref);
const results = [];
try {
  const oldDir = join(dir, 'supabase/migrations');
  const text = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const deployed = new Set(readdirSync(oldDir));
  const current = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f));
  // Applied migrations are never rewritten; a changed one would make this check meaningless.
  // (Compared without line endings: a Windows worktree checkout may convert them.)
  for (const file of current) if (deployed.has(file) && text(join('supabase/migrations', file)) !== text(join(oldDir, file))) throw Error(`Applied migration changed: ${file}`);
  const unknown = current.filter(f => !deployed.has(f) && !pending.includes(f));
  if (unknown.length) throw Error(`New migrations not covered by the compat states: ${unknown.join(', ')}`);
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const options = { cwd: dir, shell: process.platform === 'win32' };
  const sh = args => execFileSync(pnpm, args, { ...options, stdio: 'inherit' });
  // Reuse pnpm's content store without linking the disposable checkout to the active dependency tree.
  sh(['install', '--offline', '--frozen-lockfile']);
  for (const name of run) {
    const state = states[name];
    for (const file of pending) if (existsSync(join(oldDir, file))) unlinkSync(join(oldDir, file));
    for (const file of pending.slice(0, state.files)) copyFileSync(join('supabase/migrations', file), join(oldDir, file));
    for (const [file, changes] of Object.entries(edits())) {
      let body = execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
      for (const [from, to] of changes) {
        if (body.split(from).length !== 2) throw Error(`Compat edit no longer matches ${file}: ${from.slice(0, 60)}…`);
        body = body.replace(from, () => to);
      }
      writeFileSync(join(dir, file), body);
    }
    console.log(`Compat [${name}]: ${ref} Worker + ${pending.slice(0, state.files).join(', ')}`);
    const args = ['test:integration', '--', ...(superseded.length ? ['--grep-invert', `"${superseded.join('|')}"`] : [])];
    const result = spawnSync(pnpm, args, { ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      // Next asks for one retry and stores it in this checkout's build cache.
      if (!(result.stdout + result.stderr).includes('Error [SecurityFatalError]')) throw Error(`Integration failed (exit ${result.status})`);
      sh(args);
    }
    results.push(name);
  }
  console.log(`Compat: ${ref} Worker passed in states ${results.join(', ')} (excluded superseded: ${superseded.length}).`);
} finally {
  if (results.length < run.length) console.error(`Compat: passed ${results.join(', ') || 'none'}; failed at ${run[results.length]}.`);
  // git cannot delete node_modules paths over 260 characters on Windows; Node can.
  clean();
}
