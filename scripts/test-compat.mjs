import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Deployment-order check: the already deployed Worker (default origin/main) runs its own real integration suite
// against the database with every new migration applied. This is the state between "migrate" and "deploy",
// and after a failed deploy or a Worker rollback. Local disposable Supabase only (same runner as test:integration).
const ref = process.argv[2] ?? 'origin/main';
// Old assertions that the new migrations deliberately tighten; each is covered by the current suite instead.
const superseded = [
  // P2: an aal2 session alone no longer activates Super Admin; the factor must be confirmed in SQL Editor (authz.spec.mjs).
  'aal2 comes only from a verified Auth session',
];
const dir = resolve('.test-runtime/compat');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); git('worktree', 'prune'); }
git('worktree', 'add', '--detach', dir, ref);
try {
  const oldDir = join(dir, 'supabase/migrations');
  const old = new Set(readdirSync(oldDir));
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f))) {
    // Applied migrations are never rewritten; a changed one would make this check meaningless.
    // (Compared without line endings: a Windows worktree checkout may convert them.)
    const text = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    if (old.has(file)) { if (text(join('supabase/migrations', file)) !== text(join(oldDir, file))) throw Error(`Applied migration changed: ${file}`); }
    else { copyFileSync(join('supabase/migrations', file), join(oldDir, file)); console.log(`Compat: adding ${file} to ${ref}`); }
  }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const run = (args) => execFileSync(pnpm, args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  run(['install', '--offline', '--frozen-lockfile']);
  run(['test:integration', '--', '--grep-invert', `"${superseded.join('|')}"`]);
  console.log(`Compat: ${ref} Worker passed against the new database (excluded superseded: ${superseded.length}).`);
} finally {
  // git cannot delete node_modules paths over 260 characters on Windows; Node can.
  rmSync(dir, { recursive: true, force: true });
  git('worktree', 'prune');
}
